import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DocsFs, makeTestDocsFs } from './DocsFs.ts'

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

    const result = await Effect.runPromise(program)
    expect(result).toEqual({ mtimeMs: 42, sizeBytes: 7 })
  })
})
