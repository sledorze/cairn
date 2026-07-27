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
})
