import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NodeContext } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toPosix } from '../core/paths.ts'
import { DocsFs, DocsFsLive } from './DocsFs.ts'

// Exercises the REAL Node binding (DocsFsLive) against a temp directory,
// complementing the in-memory unit tests of the Effect programs.

let root = ''

const run = <A>(eff: Effect.Effect<A, never, DocsFs>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeContext.layer)))

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
})
