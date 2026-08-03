// Filesystem capability for the docs checkers, expressed as an Effect service
// so programs stay testable. `DocsFsLive` binds it to the real Node platform
// (via @effect/platform-node); `makeTestDocsFs` provides an in-memory layer.

import type { Dirent } from 'node:fs'
import * as NodeFsPromises from 'node:fs/promises'

import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'

import { matchesAny } from '../core/glob.ts'
import { isIgnored, isInScope, isWithinBase, relativeToBase, toPosix } from '../core/paths.ts'

export interface FileStat {
  readonly mtimeMs: number
  readonly sizeBytes: number
}

export interface DocsFsService {
  readonly deleteFile: (abs: string) => Effect.Effect<void>
  readonly exists: (abs: string) => Effect.Effect<boolean>
  /**
   * `ignore` (issue #63): glob patterns matched against a discovered
   * DIRECTORY's own absolute POSIX path (both bare, e.g. `node_modules`
   * matching a literal `"node_modules"` entry, and with a trailing `/` so a
   * `"**\/node_modules/**"`-style pattern — this repo's own default `ignore`
   * — matches too) PRUNE that directory before it's ever recursed into, not
   * just filtered out of the returned list afterward. This is the actual
   * fix for the OOM: a root containing a real `node_modules` used to be
   * fully walked and `stat`'d, multi-GB tree and all, before `ignore` was
   * ever consulted downstream in the checkers. A file-shaped ignore pattern
   * (no directory it matches) still only removes that one file from the
   * result, same as before — only DIRECTORY pruning is new.
   */
  readonly listFiles: (roots: readonly string[], ignore?: readonly string[]) => Effect.Effect<readonly string[]>
  readonly readFile: (abs: string) => Effect.Effect<string>
  /**
   * Resolve `abs` to its real, symlink-free canonical path — `null` if it
   * can't be resolved (doesn't exist, a broken link, a permission error).
   * Exists so a containment check (`../core/paths.ts`'s `isWithinBase`) can
   * be re-run against the RESOLVED path, not just the lexical one: a
   * symlink physically located inside a checked-out repo can still point
   * outside it, and a lexical `isWithinBase` pass on the link's own path
   * can't see that (adversarial review — see
   * `../program/structure/CheckCoverage.ts`'s own use of this).
   */
  readonly realPath: (abs: string) => Effect.Effect<string | null>
  readonly stat: (abs: string) => Effect.Effect<FileStat>
  readonly writeFile: (abs: string, content: string) => Effect.Effect<void>
}

export class DocsFs extends Context.Service<DocsFs, DocsFsService>()('DocsFs') {}

/**
 * The composite "safe to read/trust" check every consumer that resolves a
 * doc-authored path against real filesystem content needs: `candidate`
 * must resolve within `base` BOTH lexically (`isWithinBase` on its own,
 * unresolved path — the cheap check, no IO) AND, if it exists, at its
 * REAL, symlink-resolved location too (`realPath` — a symlink physically
 * located inside `base` can still point outside it, and the lexical check
 * alone can't see that). `false` for anything unresolvable (doesn't exist,
 * a broken/looping link, a permission error) — never assumed safe by
 * default.
 *
 * Extracted (issue #28's PR, 8th review pass) after adversarial review
 * found this exact shape hand-duplicated across four call sites —
 * `CheckCoverage.ts`, `CheckLinks.ts`, `CheckRefs.ts`, `CheckProseRefs.ts`
 * — each independently re-deriving the same two-step lexical-then-real
 * check. One definition means a future third check (e.g. a hardlink
 * nuance, a case-sensitivity fix) lands once, not four times with the
 * risk of the four copies drifting apart unnoticed.
 */
export const isSafelyWithinBase = (
  dfs: Pick<DocsFsService, 'realPath'>,
  candidate: string,
  base: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (!isWithinBase(candidate, base)) {
      return false
    }
    const real = yield* dfs.realPath(candidate)
    return real !== null && isWithinBase(real, base)
  })

/**
 * Every in-scope `.md` doc's content, as a `path -> content` map — issue
 * #48's `trackedFiles` narrowing (an untracked doc is invisible to a fresh
 * CI checkout, so a local run with `onlyGitTracked` on must be too) applied
 * BEFORE reading, and a file-level `ignore` re-check (`isIgnored`, issue
 * #102) since `listFiles`'s own `ignore` handling only prunes DIRECTORIES,
 * never a file-shaped pattern. A doc that lists fine but can't actually be
 * READ (permission denied, revoked between listing and reading) is
 * silently excluded, not a crash — `dfs.readFile` is `Effect.orDie`-wrapped,
 * so this reaches the DEFECT channel; skipped the same way an untracked/
 * ignored doc already is.
 *
 * Extracted (issue #106's own PR) after this exact shape turned up
 * hand-duplicated between `CheckSummaries.ts`'s own `readMarkdown` and
 * `CheckDeletions.ts`'s `readMarkdownCorpus` — the latter freshly written
 * WITH this file-level `isIgnored` re-check. For `CheckSummaries.ts` this
 * re-check is redundant today (verified by disabling it locally and
 * re-running the full suite: nothing failed, because `SummaryTree.ts`'s
 * `planSummaries` already filters every node it builds by the same
 * `isIgnored` — see `SummaryTree.unit.test.ts`'s own root-relative-ignore
 * coverage, the one place this behavior is actually pinned for that
 * caller). For `CheckDeletions.ts` it is NOT redundant — `remainingFiles`
 * is read directly, with no `planSummaries`-style filter downstream — so
 * without this check here, an ignored file's content would wrongly count
 * as "content survives" for an orphaned-heading/link comparison; see
 * `CheckDeletions.unit.test.ts` for that regression coverage. One shared
 * definition means a future caller gets the correct (CheckDeletions-shaped)
 * behavior by default, without needing to know which of the two existing
 * callers happened to need it.
 */
export const readMarkdownCorpus = (
  dfs: Pick<DocsFsService, 'listFiles' | 'readFile'>,
  roots: readonly string[],
  ignore: readonly string[],
  trackedFiles?: ReadonlySet<string>,
): Effect.Effect<Map<string, string>> =>
  Effect.gen(function* () {
    const all = yield* dfs.listFiles(roots, ignore)
    const files = new Map<string, string>()
    for (const file of all) {
      if (!file.endsWith('.md') || isIgnored(file, ignore, roots)) {
        continue
      }
      if (trackedFiles !== undefined && !trackedFiles.has(file)) {
        continue
      }
      const content = yield* dfs.readFile(file).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      if (content !== null) {
        files.set(file, content)
      }
    }
    return files
  })

/** Live implementation bound to the Node filesystem. */
export const DocsFsLive = Layer.effect(
  DocsFs,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    // `FileSystem.readDirectory` returns bare names (no Dirent-style type info),
    // so telling files from directories still costs one `stat` per entry — but
    // those stats are independent, so bounding their concurrency (rather than
    // awaiting them one at a time) lets the underlying I/O overlap instead of
    // serializing on a tree with many entries. 32 caps outstanding file
    // descriptors well clear of typical `ulimit -n` defaults.
    const STAT_CONCURRENCY = 32

    // A single bad entry anywhere in the tree — a broken symlink, an
    // unreadable subdirectory, a pathologically long/deep path — must not
    // crash the WHOLE scan (found via adversarial "no unhandled exception"
    // review, reproduced for real: a permission-denied subdirectory made
    // even `fs.readDirectory(root, { recursive: true })` itself fail
    // entirely — Node's built-in recursive walk gives up on the first
    // subdirectory it can't `scandir`, not just the one bad entry). Walking
    // one directory level at a time — rather than using `recursive: true`
    // — means a directory-level failure (`readDirectory`) is caught exactly
    // where it happens, so only the unreadable SUBTREE is excluded, not
    // every file elsewhere in the same root.
    // `atRoot` distinguishes the directory the CALLER explicitly asked to
    // scan from every directory `walk` discovers by recursing into it.
    // Found via a SECOND round of adversarial review, reproduced for real:
    // an earlier version of this fix caught a `readDirectory` failure at
    // EVERY level identically, including the very first call on `root`
    // itself — so a permission-denied ROOT (as opposed to a nested
    // subdirectory) silently returned zero files instead of the nested-
    // failure "exclude just that subtree" behavior this fix intends. Zero
    // files reads as "nothing to check," which is INDISTINGUISHABLE from a
    // legitimately empty docs directory — `cairn check` would report
    // `✅ OK, 0 checked` and exit 0 having silently checked nothing, which
    // is a worse failure mode than the original crash (a crash is at least
    // loud). A directory the caller explicitly named as a root must fail
    // loudly if it can't be read at all; only directories discovered DURING
    // traversal get the lenient "exclude the bad subtree" treatment.
    // No explicit return-type annotation: `atRoot: true` deliberately lets a
    // real `readDirectory` failure propagate as a typed error (caught by the
    // outer `listFiles`'s `.pipe(Effect.orDie)`, same as it always has been
    // for a genuinely inaccessible root) — annotating this `never`-error
    // would silently re-swallow the exact failure this fix exists to
    // surface, right back to the bug found via adversarial review.
    // A directory is pruned when EITHER its absolute POSIX path, or its path
    // RELATIVE to the root it's being walked under, matches an `ignore` glob
    // — tested both bare (a literal pattern like `"node_modules"`) and with
    // a trailing `/` appended (so a `"**/x/**"` pattern matches the
    // directory itself, not just its contents). Absolute matching is the
    // pre-existing contract (a pattern that happens to BE the absolute
    // path, or is `**/`-prefixed so it can absorb one, already worked and
    // must keep working); relative matching is the fix for issue #102 — a
    // pattern with no leading `**/`, the form anyone actually writes for a
    // top-level directory (e.g. `.agents/**`), is authored root-relative
    // (as `ignore`'s own default, `"**/node_modules/**"`, already implies
    // for the "anywhere in the tree" case) and previously could never match
    // an absolute filesystem path at all.
    const isPrunedDir = (abs: string, ignore: readonly string[], rootBase: string): boolean => {
      const absPosix = toPosix(abs)
      const rel = relativeToBase(abs, rootBase)
      return (
        matchesAny(absPosix, ignore) ||
        matchesAny(`${absPosix}/`, ignore) ||
        matchesAny(rel, ignore) ||
        matchesAny(`${rel}/`, ignore)
      )
    }

    const walk = (
      dir: string,
      atRoot: boolean,
      ignore: readonly string[],
      roots: readonly string[],
      rootBase: string,
    ): Effect.Effect<readonly string[], PlatformError> =>
      Effect.gen(function* () {
        // `withFileTypes: true` gets file-vs-directory type from the SAME
        // `readdir` syscall that already lists the directory's entries —
        // Node's `Dirent` carries it for free (populated from `d_type` on
        // platforms that support it, or a cheap internal `lstat` otherwise,
        // either way one call, not two). The previous version called
        // `fs.stat` on every single entry just to answer "file or
        // directory," a second syscall per entry that this makes
        // unnecessary for the common case. Only a `Dirent.isSymbolicLink()`
        // entry still needs an explicit (link-following) `stat` below, to
        // resolve what it actually points at — Dirent only reports the
        // entry's OWN type, never a symlink's target.
        const readDir = Effect.tryPromise({
          catch: (cause) => cause as PlatformError,
          try: () => NodeFsPromises.readdir(dir, { withFileTypes: true }),
        })
        const entries = yield* atRoot
          ? readDir
          : readDir.pipe(Effect.catch(() => Effect.succeed<readonly Dirent[]>([])))
        const nested = yield* Effect.forEach(
          entries,
          (entry) => {
            const abs = path.join(dir, entry.name)
            // Pruned BEFORE recursing — the actual OOM fix (issue #63): a
            // matching directory (e.g. a real `node_modules`) is never
            // `readDirectory`'d/`stat`'d at all, not merely excluded from
            // the final list after being fully walked.
            const recurseIntoDir = (): Effect.Effect<readonly string[], PlatformError> =>
              isPrunedDir(abs, ignore, rootBase)
                ? Effect.succeed<readonly string[]>([])
                : walk(abs, false, ignore, roots, rootBase)
            if (entry.isDirectory()) {
              return recurseIntoDir()
            }
            if (entry.isFile()) {
              return Effect.succeed([abs])
            }
            if (!entry.isSymbolicLink()) {
              // Matches the pre-existing contract exactly: only regular
              // files (and, below, symlinks resolving to one) are
              // collected. Anything else (a device, socket, or other
              // non-regular entry) is silently excluded, same as before.
              return Effect.succeed<readonly string[]>([])
            }
            // A symlink's OWN Dirent type never tells us what it points at
            // (or whether the target even exists) — the one case that still
            // needs a real, link-following `stat`, exactly as every entry
            // used to before this optimization. Resolved the same way a
            // non-symlink entry is: a directory recurses (and can still be
            // pruned), a file is collected, anything else is excluded —
            // deliberately NOT collapsed into "not a directory therefore
            // excluded," which would silently drop every symlink-to-file.
            //
            // Adversarial finding, security-relevant (issue #28's PR, 5th
            // review pass): a symlink can resolve to a REAL path OUTSIDE
            // every configured root — a malicious PR needs only to commit
            // one pointing at an absolute path that exists on the CI
            // runner (a secret file, an SSH key). Following it unbounded
            // would scan that external content as if it were a native
            // repo doc (a file symlink) or recurse an entire external
            // subtree into the corpus (a directory symlink) — the same
            // filesystem-escape class the link-target `isWithinBase`/
            // `realPath` fixes elsewhere in this PR close, but for
            // DISCOVERY itself, upstream of every one of those fixes.
            // `fs.realPath` resolves the canonical target; a symlink
            // whose real path falls outside every root is excluded/never
            // recursed into, exactly like a `node_modules`-shaped
            // `isPrunedDir` match — no `base` concept needed here, since
            // "outside every configured root" is self-contained within
            // what `listFiles` was already asked to scan.
            return fs.stat(abs).pipe(
              Effect.flatMap((info) => {
                if (info.type !== 'Directory' && info.type !== 'File') {
                  return Effect.succeed<readonly string[]>([])
                }
                return fs.realPath(abs).pipe(
                  Effect.flatMap((real) => {
                    if (!roots.some((r) => isWithinBase(real, r))) {
                      return Effect.succeed<readonly string[]>([])
                    }
                    return info.type === 'Directory' ? recurseIntoDir() : Effect.succeed([abs])
                  }),
                )
              }),
              // `fs.stat`/`fs.realPath`'s failure is a typed `PlatformError`
              // (ENOENT on a broken symlink, EACCES, ENAMETOOLONG, ...), not
              // a defect — `Effect.catch` (v4's `catchAll`) is the right
              // combinator here, not `catchDefect`. Confirmed by
              // construction: a `catchDefect`-only version still crashed on
              // a real broken symlink, because the failure never reaches
              // the defect channel at all. Entries found by recursing
              // (never the caller-named root itself) always get this
              // lenient treatment — a bad FILE stat inside an otherwise-
              // readable root is excluded, never treated as root-level
              // failure.
              Effect.catch(() => Effect.succeed<readonly string[]>([])),
            )
          },
          { concurrency: STAT_CONCURRENCY },
        )
        return nested.flat()
      })

    const listFiles = (roots: readonly string[], ignore: readonly string[] = []): Effect.Effect<readonly string[]> =>
      Effect.gen(function* () {
        const out: string[] = []
        for (const root of roots) {
          const present = yield* fs.exists(root)
          if (!present) {
            continue
          }
          for (const abs of yield* walk(root, true, ignore, roots, root)) {
            // Normalise to POSIX so the pure planners see `/` paths on every OS.
            out.push(toPosix(abs))
          }
        }
        return out
      }).pipe(Effect.orDie)

    const stat = (abs: string): Effect.Effect<FileStat> =>
      fs.stat(abs).pipe(
        Effect.map((info) => ({
          mtimeMs: Option.match(info.mtime, { onNone: () => 0, onSome: (d) => d.getTime() }),
          sizeBytes: Number(info.size),
        })),
        Effect.orDie,
      )

    // Every existing caller wrote into a directory that was already there (a doc's
    // own directory, always present since the doc itself lives in it). That
    // invariant broke the moment sidecar writes started targeting a brand-new
    // `.cairn/**` tree (StampStore.ts / CheckSummaries.ts) — the FIRST sidecar
    // under a given directory has no directory to write into yet. `recursive:
    // true` makes this a no-op when the directory already exists, so it's safe
    // to do unconditionally rather than only for `.cairn/**` paths.
    const writeFile = (abs: string, content: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(abs), { recursive: true })
        yield* fs.writeFileString(abs, content)
      }).pipe(Effect.orDie)

    return {
      deleteFile: (abs) => fs.remove(abs).pipe(Effect.orDie),
      exists: (abs) => fs.exists(abs).pipe(Effect.orDie),
      listFiles,
      readFile: (abs) => fs.readFileString(abs).pipe(Effect.orDie),
      // `Effect.catch` (v4's `catchAll`) to `null` — same "can't resolve,
      // hand the caller a decidable absence, don't crash the run" discipline
      // every sibling method here already applies to its own failure mode.
      realPath: (abs) => fs.realPath(abs).pipe(Effect.catch(() => Effect.succeed(null))),
      stat,
      writeFile,
    }
  }),
)

export interface TestFile {
  readonly content: string
  readonly mtimeMs: number
}

/**
 * In-memory DocsFs layer for tests. `files` maps absolute path -> file.
 * `writeFile` mutates the backing map so fix behaviour can be asserted.
 */
export const makeTestDocsFs = (files: Record<string, TestFile>): Layer.Layer<DocsFs> => {
  const store = new Map<string, TestFile>(Object.entries(files))

  const dirsOf = (): Set<string> => {
    const dirs = new Set<string>()
    for (const abs of store.keys()) {
      let dir = abs.slice(0, abs.lastIndexOf('/'))
      while (dir.length > 0 && !dirs.has(dir)) {
        dirs.add(dir)
        dir = dir.slice(0, dir.lastIndexOf('/'))
      }
    }
    return dirs
  }

  const service: DocsFsService = {
    deleteFile: (abs) => Effect.sync(() => void store.delete(abs)),
    exists: (abs) => Effect.sync(() => store.has(abs) || dirsOf().has(abs)),
    // Emulates real directory pruning (issue #63) over the flat in-memory
    // store: a file is excluded when ANY ancestor directory of its path
    // matches `ignore` (bare or trailing-slash), same check `isPrunedDir`
    // makes in the real walk — not just when the file's own path matches.
    listFiles: (roots, ignore = []) =>
      Effect.sync(() =>
        [...store.keys()].filter((p) => {
          if (!isInScope(p, roots)) {
            return false
          }
          const segments = p.split('/')
          for (let i = 1; i < segments.length; i += 1) {
            const ancestor = segments.slice(0, i).join('/')
            if (matchesAny(ancestor, ignore) || matchesAny(`${ancestor}/`, ignore)) {
              return false
            }
          }
          return true
        }),
      ),
    readFile: (abs) =>
      Effect.sync(() => {
        const f = store.get(abs)
        if (!f) {
          throw new Error(`ENOENT: ${abs}`)
        }
        return f.content
      }),
    // No symlink concept in this in-memory double — a path present in the
    // store (file or directory) resolves to itself; anything else is
    // unresolvable. A symlink-escape scenario needs a real filesystem (see
    // CheckCoverage.integration.test.ts), the same way this double already
    // can't model an unreadable-but-listed file.
    realPath: (abs) => Effect.sync(() => (store.has(abs) || dirsOf().has(abs) ? abs : null)),
    stat: (abs) =>
      Effect.sync(() => {
        const f = store.get(abs)
        if (!f) {
          throw new Error(`ENOENT: ${abs}`)
        }
        return { mtimeMs: f.mtimeMs, sizeBytes: Buffer.byteLength(f.content) }
      }),
    writeFile: (abs, content) =>
      Effect.sync(() => {
        store.set(abs, { content, mtimeMs: (store.get(abs)?.mtimeMs ?? 0) + 1 })
      }),
  }

  return Layer.succeed(DocsFs, service)
}
