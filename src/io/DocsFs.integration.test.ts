import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toPosix } from '../core/paths.ts'
import { DocsFs, DocsFsLive } from './DocsFs.ts'

// Exercises the REAL Node binding (DocsFsLive) against a temp directory,
// complementing the in-memory unit tests of the Effect programs.

let root = ''

const run = <A>(eff: Effect.Effect<A, never, DocsFs>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeServices.layer)))

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-'))
  fs.mkdirSync(path.join(root, 'a'), { recursive: true })
  fs.mkdirSync(path.join(root, 'b'), { recursive: true })
  fs.writeFileSync(path.join(root, 'a', 'x.md'), '# hello')
  fs.writeFileSync(path.join(root, 'a', 'note.txt'), 'plain')
  fs.writeFileSync(path.join(root, 'b', 'z.md'), '# z')
})

afterAll(() => {
  if (root) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe('DocsFsLive()', () => {
  it('lists every file recursively under the roots', async () => {
    const files = await run(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        return yield* dfs.listFiles([root])
      }),
    )
    expect(files.toSorted()).toEqual(
      [path.join(root, 'a', 'note.txt'), path.join(root, 'a', 'x.md'), path.join(root, 'b', 'z.md')]
        .map(toPosix)
        .toSorted(),
    )
  })

  it('reads content, stats size/mtime and resolves existence', async () => {
    const result = await run(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        const content = yield* dfs.readFile(path.join(root, 'a', 'x.md'))
        const info = yield* dfs.stat(path.join(root, 'a', 'x.md'))
        const here = yield* dfs.exists(path.join(root, 'a', 'x.md'))
        const gone = yield* dfs.exists(path.join(root, 'a', 'ghost.md'))
        return { content, gone, here, sizeBytes: info.sizeBytes }
      }),
    )
    expect(result.content).toBe('# hello')
    expect(result.sizeBytes).toBe(7)
    expect(result.here).toBeTruthy()
    expect(result.gone).toBeFalsy()
  })

  it('writes a file that can then be read back', async () => {
    const target = path.join(root, 'a', 'written.md')
    const content = await run(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile(target, '# written')
        return yield* dfs.readFile(target)
      }),
    )
    expect(content).toBe('# written')
  })

  it('writes a file whose parent directory tree does not exist yet, creating it (needed for .cairn/** sidecars)', async () => {
    const target = path.join(root, '.cairn', 'a', 'x.summary.md.json')
    const content = await run(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile(target, '{"sha256":"abc","version":1}')
        return yield* dfs.readFile(target)
      }),
    )
    expect(content).toBe('{"sha256":"abc","version":1}')
  })

  it('deletes a file so it no longer exists', async () => {
    const target = path.join(root, 'a', 'to-delete.md')
    const existsAfter = await run(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile(target, '# temp')
        yield* dfs.deleteFile(target)
        return yield* dfs.exists(target)
      }),
    )
    expect(existsAfter).toBeFalsy()
  })

  // Found via adversarial "no unhandled exception" review: `listFiles`'s
  // per-entry `fs.stat` used to be wrapped only by the OUTER `Effect.orDie`,
  // so a single bad entry (a broken symlink, a pathologically long/deep
  // path) died the WHOLE scan with a raw, unhandled PlatformError — reliably
  // reproducible against real content a messy or hostile repo can contain,
  // not a hypothetical. Real filesystem, not the in-memory double: a broken
  // symlink can't even be represented in `makeTestDocsFs`'s plain
  // path->content map.
  describe('a single bad entry must not crash the whole scan (real filesystem only)', () => {
    it('a broken symlink is silently excluded, not a crash', async () => {
      const brokenLinkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-symlink-'))
      try {
        fs.writeFileSync(path.join(brokenLinkDir, 'ok.md'), '# ok')
        fs.symlinkSync('/nonexistent-target-xyz', path.join(brokenLinkDir, 'broken.md'))
        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([brokenLinkDir])
          }),
        )
        expect(files).toEqual([toPosix(path.join(brokenLinkDir, 'ok.md'))])
      } finally {
        fs.rmSync(brokenLinkDir, { force: true, recursive: true })
      }
    })

    // `Dirent.isSymbolicLink()` only reports that the entry IS a symlink,
    // never what it points at — a working symlink needs a real,
    // link-following `stat` to resolve its target, exactly like every
    // entry used to need before switching to `withFileTypes: true`. A
    // symlink resolving to a regular FILE is the case an earlier draft of
    // this optimization silently dropped (conflated with "not a
    // directory, therefore excluded") — this pins the fix.
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
    const supportsSymlinks = process.platform !== 'win32' && !isRoot
    it.skipIf(!supportsSymlinks)('a symlink resolving to a real file is included, not silently dropped', async () => {
      const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-symlink-file-'))
      try {
        fs.writeFileSync(path.join(linkDir, 'target.md'), '# target')
        fs.symlinkSync(path.join(linkDir, 'target.md'), path.join(linkDir, 'link.md'))
        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([linkDir])
          }),
        )
        expect([...files].toSorted()).toEqual(
          [toPosix(path.join(linkDir, 'target.md')), toPosix(path.join(linkDir, 'link.md'))].toSorted(),
        )
      } finally {
        fs.rmSync(linkDir, { force: true, recursive: true })
      }
    })

    // Adversarial finding, security-relevant (issue #28's PR, 5th review
    // pass): the two tests above prove a symlink resolving WITHIN the
    // scanned root is followed — legitimate. This proves the boundary:
    // a symlink resolving OUTSIDE every configured root must never be
    // followed at all, whether it's a file (its content would otherwise
    // be scanned as if it were a native repo doc, e.g. leaking a secret
    // file's text into a broken-link/anchor report) or a directory (its
    // entire external subtree would otherwise be recursed into and
    // treated as part of the corpus). A malicious PR needs only to commit
    // a symlink to an absolute path that exists on the CI runner.
    it.skipIf(!supportsSymlinks)(
      'a symlink to a FILE outside every configured root is excluded, not scanned as a doc',
      async () => {
        const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-symlink-escape-file-'))
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-symlink-escape-outside-'))
        try {
          fs.writeFileSync(path.join(linkDir, 'ok.md'), '# ok')
          fs.writeFileSync(path.join(outsideDir, 'secret.md'), '# not part of the repo')
          fs.symlinkSync(path.join(outsideDir, 'secret.md'), path.join(linkDir, 'escape.md'))
          const files = await run(
            Effect.gen(function* () {
              const dfs = yield* DocsFs
              return yield* dfs.listFiles([linkDir])
            }),
          )
          expect(files).toEqual([toPosix(path.join(linkDir, 'ok.md'))])
        } finally {
          fs.rmSync(linkDir, { force: true, recursive: true })
          fs.rmSync(outsideDir, { force: true, recursive: true })
        }
      },
    )

    it.skipIf(!supportsSymlinks)(
      'a symlink to a DIRECTORY outside every configured root is never recursed into',
      async () => {
        const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-symlink-escape-dir-'))
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-symlink-escape-outside-dir-'))
        try {
          fs.writeFileSync(path.join(linkDir, 'ok.md'), '# ok')
          fs.writeFileSync(path.join(outsideDir, 'secret.md'), '# not part of the repo')
          fs.symlinkSync(outsideDir, path.join(linkDir, 'escaped-dir'), 'dir')
          const files = await run(
            Effect.gen(function* () {
              const dfs = yield* DocsFs
              return yield* dfs.listFiles([linkDir])
            }),
          )
          expect(files).toEqual([toPosix(path.join(linkDir, 'ok.md'))])
        } finally {
          fs.rmSync(linkDir, { force: true, recursive: true })
          fs.rmSync(outsideDir, { force: true, recursive: true })
        }
      },
    )

    it.skipIf(!supportsSymlinks)('a symlink resolving to a real directory is recursed into', async () => {
      const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-symlink-dir-'))
      try {
        fs.mkdirSync(path.join(linkDir, 'real'))
        fs.writeFileSync(path.join(linkDir, 'real', 'inner.md'), '# inner')
        fs.symlinkSync(path.join(linkDir, 'real'), path.join(linkDir, 'linked'), 'dir')
        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([linkDir])
          }),
        )
        expect(files).toContainEqual(toPosix(path.join(linkDir, 'linked', 'inner.md')))
      } finally {
        fs.rmSync(linkDir, { force: true, recursive: true })
      }
    })

    // A named pipe (FIFO) is neither a regular file nor a directory —
    // `Dirent.isFile()`/`isDirectory()` are both false for it, same as any
    // other non-regular entry (a socket, a device). Excluded silently, same
    // as before this optimization; real, not simulated, since a FIFO can't
    // be represented in `makeTestDocsFs`'s plain path->content map either.
    let supportsMkfifo = process.platform !== 'win32'
    if (supportsMkfifo) {
      try {
        execFileSync('mkfifo', ['--version'], { stdio: 'ignore' })
      } catch {
        supportsMkfifo = false
      }
    }
    it.skipIf(!supportsMkfifo)('a named pipe (FIFO) entry is silently excluded, not a crash', async () => {
      const fifoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-fifo-'))
      try {
        fs.writeFileSync(path.join(fifoDir, 'ok.md'), '# ok')
        execFileSync('mkfifo', [path.join(fifoDir, 'pipe.md')])
        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([fifoDir])
          }),
        )
        expect(files).toEqual([toPosix(path.join(fifoDir, 'ok.md'))])
      } finally {
        fs.rmSync(fifoDir, { force: true, recursive: true })
      }
    })

    // A SYMLINK to a FIFO — distinct from the bare-FIFO case above: a
    // symlink's own Dirent type never says what it points at, so this
    // exercises the `info.type` neither-Directory-nor-File branch AFTER a
    // real, link-following `stat` (the FIFO test above never reaches that
    // code path at all, since a bare FIFO entry is excluded earlier, by
    // its own Dirent type). Same silent-exclusion contract either way.
    it.skipIf(!supportsMkfifo)('a symlink to a named pipe (FIFO) is silently excluded, not a crash', async () => {
      const fifoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-fifo-symlink-'))
      try {
        fs.writeFileSync(path.join(fifoDir, 'ok.md'), '# ok')
        const pipePath = path.join(fifoDir, 'real-pipe')
        execFileSync('mkfifo', [pipePath])
        fs.symlinkSync(pipePath, path.join(fifoDir, 'pipe-link.md'))
        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([fifoDir])
          }),
        )
        expect(files).toEqual([toPosix(path.join(fifoDir, 'ok.md'))])
      } finally {
        fs.rmSync(fifoDir, { force: true, recursive: true })
      }
    })

    // A subdirectory with execute permission removed makes `stat` on
    // anything inside it fail with EACCES during traversal — a real,
    // portable, deterministic way to trigger the SAME class of failure
    // `listFiles`'s per-entry stat must survive (any `PlatformError`, not
    // specifically ENOENT). Skipped when running as root (root bypasses
    // Unix permission bits entirely, so the failure this test exists to
    // prove wouldn't actually occur) or on a platform where `chmod` doesn't
    // enforce POSIX permission bits (Windows) — same guard style as this
    // repo's own existing tests would need for platform-conditional cases.
    const supportsPosixPermissions = process.platform !== 'win32' && !isRoot
    it.skipIf(!supportsPosixPermissions)(
      'an unreadable (no-execute) subdirectory is silently excluded, not a crash',
      async () => {
        const permDeniedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-perm-'))
        try {
          fs.writeFileSync(path.join(permDeniedRoot, 'ok.md'), '# ok')
          const lockedDir = path.join(permDeniedRoot, 'locked')
          fs.mkdirSync(lockedDir)
          fs.writeFileSync(path.join(lockedDir, 'inner.md'), '# inner')
          fs.chmodSync(lockedDir, 0o000)
          try {
            const files = await run(
              Effect.gen(function* () {
                const dfs = yield* DocsFs
                return yield* dfs.listFiles([permDeniedRoot])
              }),
            )
            expect(files).toContainEqual(toPosix(path.join(permDeniedRoot, 'ok.md')))
          } finally {
            // Restore permissions before rmSync — an unreadable directory
            // can't be recursively removed either.
            fs.chmodSync(lockedDir, 0o755)
          }
        } finally {
          fs.rmSync(permDeniedRoot, { force: true, recursive: true })
        }
      },
    )

    // Found via a SECOND, independent round of adversarial review of the
    // first fix: an earlier version caught a `readDirectory` failure
    // identically at EVERY level, INCLUDING the very first call on a root
    // the caller explicitly named. That made a permission-denied ROOT
    // silently return zero files — indistinguishable from a legitimately
    // empty docs directory, so `cairn check` reported `✅ OK, 0 checked`
    // and exited 0 having silently checked nothing. That is a WORSE failure
    // mode than the original crash (a crash is at least loud); this test
    // pins the fix: a root that can't be read at all must still fail, never
    // silently report success.
    it.skipIf(!supportsPosixPermissions)(
      'a permission-denied ROOT (the directory the caller named, not a nested one) fails loudly — never silently reports zero files as success',
      async () => {
        const permDeniedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-root-perm-'))
        try {
          fs.writeFileSync(path.join(permDeniedRoot, 'ok.md'), '# ok')
          fs.chmodSync(permDeniedRoot, 0o000)
          try {
            await expect(
              run(
                Effect.gen(function* () {
                  const dfs = yield* DocsFs
                  return yield* dfs.listFiles([permDeniedRoot])
                }),
              ),
            ).rejects.toBeTruthy() // never resolves to an empty (or any) file list
          } finally {
            fs.chmodSync(permDeniedRoot, 0o755)
          }
        } finally {
          fs.rmSync(permDeniedRoot, { force: true, recursive: true })
        }
      },
    )
  })

  // Issue #63: `roots: ["."]`-style scans OOM-crashed on a real `node_modules`
  // because `walk()` fully materialized (readDirectory + stat, recursively)
  // every ignored directory before `ignore` was ever consulted downstream.
  describe('`ignore` prunes matching directories DURING the walk, not after (issue #63)', () => {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
    const supportsSymlinks = process.platform !== 'win32' && !isRoot

    // A self-referential symlink inside the ignored directory: if pruning
    // ever failed and `walk` entered it, this does NOT infinite-loop (worth
    // recording precisely, since an earlier draft of this comment claimed it
    // would) — measured directly by temporarily disabling the prune check:
    // it terminates in milliseconds via a real `ENAMETOOLONG` once the
    // symlinked path grows past the OS limit, caught by this file's own
    // existing crash-resilience fix (the `Effect.catch` on a nested
    // `readDirectory` failure). So this test's real signal is the plain
    // assertion below (`pkg.md` — and `node_modules` at all — never appear),
    // same as the simpler "bare directory name" test just after it; the
    // symlink only adds coverage that a pathological entry INSIDE a pruned
    // directory can't produce a partial or malformed result either, since
    // it's never looked at.
    it.skipIf(!supportsSymlinks)(
      'never descends into a pruned directory, even one containing a self-referential symlink',
      async () => {
        const pruneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-prune-'))
        try {
          fs.writeFileSync(path.join(pruneRoot, 'kept.md'), '# kept')
          const ignoredDir = path.join(pruneRoot, 'node_modules')
          fs.mkdirSync(ignoredDir)
          fs.writeFileSync(path.join(ignoredDir, 'pkg.md'), '# should never be seen')
          fs.symlinkSync(ignoredDir, path.join(ignoredDir, 'self-loop'), 'dir')

          const files = await run(
            Effect.gen(function* () {
              const dfs = yield* DocsFs
              return yield* dfs.listFiles([pruneRoot], ['**/node_modules/**'])
            }),
          )

          expect(files).toContainEqual(toPosix(path.join(pruneRoot, 'kept.md')))
          expect(files.some((f) => f.includes('node_modules'))).toBeFalsy()
        } finally {
          fs.rmSync(pruneRoot, { force: true, recursive: true })
        }
      },
    )

    // The actual reported bug (issue #63): a genuinely large ignored subtree
    // — real `node_modules` scale, not a toy fixture — must not cost
    // anything proportional to its size. Nested (not flat) so a
    // non-recursive `readdir` call couldn't accidentally "cheat" this test.
    it('a large, deeply-nested ignored subtree costs ~nothing — proves the OOM fix at real scale, not just a small unit case', async () => {
      const pruneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-prune-scale-'))
      try {
        fs.writeFileSync(path.join(pruneRoot, 'kept.md'), '# kept')
        const nodeModules = path.join(pruneRoot, 'node_modules')
        fs.mkdirSync(nodeModules)
        const PACKAGES = 200
        const FILES_PER_PACKAGE = 20
        for (let i = 0; i < PACKAGES; i += 1) {
          const pkgDir = path.join(nodeModules, `pkg-${i}`)
          fs.mkdirSync(pkgDir)
          for (let j = 0; j < FILES_PER_PACKAGE; j += 1) {
            fs.writeFileSync(path.join(pkgDir, `file-${j}.js`), '// noop')
          }
        }
        // 200 * 20 = 4000 files across 200 subdirectories — real walking
        // (readdir + stat per entry) of this tree takes tens of ms at
        // minimum; a `node_modules` at real-world scale (tens of thousands
        // of files) would take seconds to minutes and hold every path in
        // memory simultaneously, which is exactly the OOM issue #63 reports.

        const start = performance.now()
        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([pruneRoot], ['**/node_modules/**'])
          }),
        )
        const elapsedMs = performance.now() - start

        expect(files).toEqual([toPosix(path.join(pruneRoot, 'kept.md'))])
        // Generous bound (real pruning should take low single-digit ms);
        // this is loose enough to never flake on a slow CI runner while
        // still being impossible to hit if the 4000-file tree were walked.
        expect(elapsedMs).toBeLessThan(500)
      } finally {
        fs.rmSync(pruneRoot, { force: true, recursive: true })
      }
    })

    it('prunes a bare (non-glob) directory name the same way', async () => {
      const pruneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-prune-bare-'))
      try {
        fs.writeFileSync(path.join(pruneRoot, 'kept.md'), '# kept')
        const ignoredDir = path.join(pruneRoot, 'vendor')
        fs.mkdirSync(ignoredDir)
        fs.writeFileSync(path.join(ignoredDir, 'inner.md'), '# should never be seen')

        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([pruneRoot], [toPosix(ignoredDir)])
          }),
        )

        expect(files).toContainEqual(toPosix(path.join(pruneRoot, 'kept.md')))
        expect(files.some((f) => f.includes('vendor'))).toBeFalsy()
      } finally {
        fs.rmSync(pruneRoot, { force: true, recursive: true })
      }
    })

    // Issue #102: `ignore` patterns are authored root-relative (as `ignore`'s
    // own default, `"**/node_modules/**"`, already implies for the "anywhere
    // in the tree" case) — but a pattern with no leading `**/`, the form
    // anyone actually writes for a top-level directory, used to be matched
    // against the walk's ABSOLUTE filesystem path and could therefore never
    // match, silently. Reproduces the exact repro from the issue: `.agents/**`
    // must prune just as reliably as the already-passing `**/.agents/**`.
    it('prunes a directory using a root-relative pattern with no leading **/ (issue #102)', async () => {
      const pruneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-prune-relative-'))
      try {
        fs.writeFileSync(path.join(pruneRoot, 'kept.md'), '# kept')
        const ignoredDir = path.join(pruneRoot, '.agents')
        fs.mkdirSync(ignoredDir)
        fs.writeFileSync(path.join(ignoredDir, 'inner.md'), '# should never be seen')

        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([pruneRoot], ['.agents/**'])
          }),
        )

        expect(files).toContainEqual(toPosix(path.join(pruneRoot, 'kept.md')))
        expect(files.some((f) => f.includes('.agents'))).toBeFalsy()
      } finally {
        fs.rmSync(pruneRoot, { force: true, recursive: true })
      }
    })

    it('an unmatched ignore pattern leaves the tree fully scanned, same as before', async () => {
      const pruneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docsfs-prune-noop-'))
      try {
        fs.mkdirSync(path.join(pruneRoot, 'kept'))
        fs.writeFileSync(path.join(pruneRoot, 'kept', 'a.md'), '# a')

        const files = await run(
          Effect.gen(function* () {
            const dfs = yield* DocsFs
            return yield* dfs.listFiles([pruneRoot], ['**/nothing-matches-this/**'])
          }),
        )

        expect(files).toContainEqual(toPosix(path.join(pruneRoot, 'kept', 'a.md')))
      } finally {
        fs.rmSync(pruneRoot, { force: true, recursive: true })
      }
    })
  })
})
