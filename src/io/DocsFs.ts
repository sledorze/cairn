// Filesystem capability for the docs checkers, expressed as an Effect service
// so programs stay testable. `DocsFsLive` binds it to the real Node platform
// (via @effect/platform-node); `makeTestDocsFs` provides an in-memory layer.

import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'

import { toPosix } from '../core/paths.ts'

export interface FileStat {
  readonly mtimeMs: number
  readonly sizeBytes: number
}

export interface DocsFsService {
  readonly deleteFile: (abs: string) => Effect.Effect<void>
  readonly exists: (abs: string) => Effect.Effect<boolean>
  readonly listFiles: (roots: readonly string[]) => Effect.Effect<readonly string[]>
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

    const listFiles = (roots: readonly string[]): Effect.Effect<readonly string[]> =>
      Effect.gen(function* () {
        const out: string[] = []
        for (const root of roots) {
          const present = yield* fs.exists(root)
          if (!present) {
            continue
          }
          const entries = yield* fs.readDirectory(root, { recursive: true })
          const abses = yield* Effect.forEach(
            entries,
            (entry) => {
              const abs = path.join(root, entry)
              return fs.stat(abs).pipe(Effect.map((info) => (info.type === 'File' ? abs : null)))
            },
            { concurrency: STAT_CONCURRENCY },
          )
          for (const abs of abses) {
            if (abs !== null) {
              // Normalise to POSIX so the pure planners see `/` paths on every OS.
              out.push(toPosix(abs))
            }
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

    return {
      deleteFile: (abs) => fs.remove(abs).pipe(Effect.orDie),
      exists: (abs) => fs.exists(abs).pipe(Effect.orDie),
      listFiles,
      readFile: (abs) => fs.readFileString(abs).pipe(Effect.orDie),
      stat,
      writeFile: (abs, content) => fs.writeFileString(abs, content).pipe(Effect.orDie),
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
    listFiles: (roots) =>
      Effect.sync(() => [...store.keys()].filter((p) => roots.some((r) => p.startsWith(`${r}/`) || p === r))),
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
