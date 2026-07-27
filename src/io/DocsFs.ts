// Filesystem capability for the docs checkers, expressed as an Effect service
// so programs stay testable. `DocsFsLive` binds it to the real Node platform
// (via @effect/platform-node); `makeTestDocsFs` provides an in-memory layer.

import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'

import { matchesAny } from '../core/glob.ts'
import { toPosix } from '../core/paths.ts'

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
  readonly stat: (abs: string) => Effect.Effect<FileStat>
  readonly writeFile: (abs: string, content: string) => Effect.Effect<void>
}

export class DocsFs extends Context.Service<DocsFs, DocsFsService>()('DocsFs') {}

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
    // A directory is pruned when its own absolute POSIX path matches an
    // `ignore` glob, tested two ways: bare (a literal pattern like
    // `"node_modules"`) and with a trailing `/` appended (so a `"**/x/**"`
    // pattern — the shape `ignore`'s own default, `"**/node_modules/**"`,
    // already uses — matches the directory itself, not just its contents).
    const isPrunedDir = (abs: string, ignore: readonly string[]): boolean => {
      const p = toPosix(abs)
      return matchesAny(p, ignore) || matchesAny(`${p}/`, ignore)
    }

    const walk = (
      dir: string,
      atRoot: boolean,
      ignore: readonly string[],
    ): Effect.Effect<readonly string[], PlatformError> =>
      Effect.gen(function* () {
        const readDir = fs.readDirectory(dir)
        const names = yield* atRoot ? readDir : readDir.pipe(Effect.catch(() => Effect.succeed<readonly string[]>([])))
        const nested = yield* Effect.forEach(
          names,
          (name) => {
            const abs = path.join(dir, name)
            return fs.stat(abs).pipe(
              Effect.flatMap((info) => {
                if (info.type === 'Directory') {
                  // Pruned BEFORE recursing — the actual OOM fix (issue
                  // #63): a matching directory (e.g. a real `node_modules`)
                  // is never `readDirectory`'d/`stat`'d at all, not merely
                  // excluded from the final list after being fully walked.
                  if (isPrunedDir(abs, ignore)) {
                    return Effect.succeed<readonly string[]>([])
                  }
                  return walk(abs, false, ignore)
                }
                // Matches the pre-existing contract exactly: only regular
                // files are collected. Anything else (a device, socket, or
                // other non-regular entry `fs.stat` can report) is silently
                // excluded, same as before.
                return Effect.succeed(info.type === 'File' ? [abs] : [])
              }),
              // `fs.stat`'s failure is a typed `PlatformError` (ENOENT on a
              // broken symlink, EACCES, ENAMETOOLONG, ...), not a defect —
              // `Effect.catch` (v4's `catchAll`) is the right combinator
              // here, not `catchDefect`. Confirmed by construction: a
              // `catchDefect`-only version still crashed on a real broken
              // symlink, because the failure never reaches the defect
              // channel at all. Entries found by recursing (never the
              // caller-named root itself) always get this lenient
              // treatment — a bad FILE stat inside an otherwise-readable
              // root is excluded, never treated as root-level failure.
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
          for (const abs of yield* walk(root, true, ignore)) {
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
          if (!roots.some((r) => p.startsWith(`${r}/`) || p === r)) {
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
