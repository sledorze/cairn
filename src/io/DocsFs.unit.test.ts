import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DocsFs, isSafelyWithinBase, makeTestDocsFs } from './DocsFs.ts'

describe('makeTestDocsFs()', () => {
  it('stat() rejects for a path not in the store, same as readFile()', async () => {
    const layer = makeTestDocsFs({})
    const program = Effect.gen(function* () {
      const dfs = yield* DocsFs
      return yield* dfs.stat('/r/missing.md')
    }).pipe(Effect.provide(layer))

    await expect(Effect.runPromise(program)).rejects.toBeTruthy()
  })

  it('stat() resolves the real mtime/size for a path in the store', async () => {
    const layer = makeTestDocsFs({ '/r/a.md': { content: '# hello', mtimeMs: 42 } })
    const program = Effect.gen(function* () {
      const dfs = yield* DocsFs
      return yield* dfs.stat('/r/a.md')
    }).pipe(Effect.provide(layer))

    await expect(Effect.runPromise(program)).resolves.toEqual({ mtimeMs: 42, sizeBytes: 7 })
  })
})

// The extracted (issue #28's PR, 8th review pass) shared composite check —
// previously hand-duplicated across CheckCoverage.ts/CheckLinks.ts/
// CheckRefs.ts/CheckProseRefs.ts. In-memory `makeTestDocsFs` has no symlink
// concept, so its `realPath` is always identity-or-null — enough to cover
// the lexical-fails, real-path-fails, and both-pass cases; the "lexically
// in-base but real path escapes" case (the whole reason this check exists)
// needs a real symlink, already proven end to end in each of those four
// consumers' own real-filesystem integration tests.
describe('isSafelyWithinBase()', () => {
  it('is true for a path that exists and resolves within base, both lexically and really', async () => {
    const layer = makeTestDocsFs({ '/r/docs/a.md': { content: '# a', mtimeMs: 1 } })
    const program = Effect.gen(function* () {
      const dfs = yield* DocsFs
      return yield* isSafelyWithinBase(dfs, '/r/docs/a.md', '/r')
    }).pipe(Effect.provide(layer))
    await expect(Effect.runPromise(program)).resolves.toBeTruthy()
  })

  it('is false, with no IO attempted, for a path that is lexically outside base', async () => {
    let realPathCalled = false
    const dfs = {
      realPath: (abs: string) => {
        realPathCalled = true
        return Effect.succeed(abs)
      },
    }
    const result = await Effect.runPromise(isSafelyWithinBase(dfs, '/etc/hostname', '/r'))
    expect(result).toBeFalsy()
    expect(realPathCalled).toBeFalsy()
  })

  it('is false for a path that is lexically in-base but does not exist (realPath resolves to null)', async () => {
    const layer = makeTestDocsFs({})
    const program = Effect.gen(function* () {
      const dfs = yield* DocsFs
      return yield* isSafelyWithinBase(dfs, '/r/docs/missing.md', '/r')
    }).pipe(Effect.provide(layer))
    await expect(Effect.runPromise(program)).resolves.toBeFalsy()
  })

  it('is false for a path lexically in-base whose REAL (resolved) path escapes base — the symlink-escape case', async () => {
    const dfs = { realPath: () => Effect.succeed('/etc/secret') }
    const result = await Effect.runPromise(isSafelyWithinBase(dfs, '/r/docs/escape-link', '/r'))
    expect(result).toBeFalsy()
  })
})
