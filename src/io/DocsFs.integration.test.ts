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

    // A subdirectory with execute permission removed makes `stat` on
    // anything inside it fail with EACCES during traversal — a real,
    // portable, deterministic way to trigger the SAME class of failure
    // `listFiles`'s per-entry stat must survive (any `PlatformError`, not
    // specifically ENOENT). Skipped when running as root (root bypasses
    // Unix permission bits entirely, so the failure this test exists to
    // prove wouldn't actually occur) or on a platform where `chmod` doesn't
    // enforce POSIX permission bits (Windows) — same guard style as this
    // repo's own existing tests would need for platform-conditional cases.
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
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
})
