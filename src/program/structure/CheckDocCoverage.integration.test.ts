import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocsFs } from '../../io/DocsFs.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { checkDocCoverage } from './CheckDocCoverage.ts'

// Real Node filesystem (DocsFsLive) — proves real cross-directory relative
// link resolution, the one thing `makeTestDocsFs`'s in-memory map can't
// prove (CheckDocCoverage.unit.test.ts already covers every OR/exempt/
// non-transitive scenario against the in-memory layer).

const run = <A>(eff: Effect.Effect<A, never, DocsFs>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeServices.layer)))

const projects: TempProject[] = []
const project = (prefix: string, files: Record<string, string> = {}): TempProject => {
  const p = makeTempProject(prefix, files)
  projects.push(p)
  return p
}
afterEach(() => {
  while (projects.length > 0) {
    projects.pop()?.dispose()
  }
})

const COVERED_BY = [{ glob: '**/docs/**', kind: 'architecture' }]
const SOURCES = ['**/src/**/*.ts']

describe('checkDocCoverage() against the real filesystem (DocsFsLive)', () => {
  it('resolves a real cross-directory relative link and reports real source coverage', async () => {
    const p = project('checkdoccoverage-real', {
      'docs/architecture.md': '# Architecture\n\n[foo](../src/foo.ts)',
      'src/foo.ts': 'export const foo = 1',
    })
    const result = await run(checkDocCoverage({ base: p.root, coveredBy: COVERED_BY, sources: SOURCES }))
    expect(result.checked).toBe(1)
    expect(result.missing).toEqual([])
  })

  it('reports a real source file with zero inbound links as missing', async () => {
    const p = project('checkdoccoverage-real-gaps', {
      'docs/architecture.md': '# Architecture, no links at all',
      'src/foo.ts': 'export const foo = 1',
    })
    const result = await run(checkDocCoverage({ base: p.root, coveredBy: COVERED_BY, sources: SOURCES }))
    expect(result.missing).toEqual([path.join(p.root, 'src/foo.ts').split(path.sep).join('/')])
  })
})
