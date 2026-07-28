import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocsFs } from '../../io/DocsFs.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { checkCoverage } from './CheckCoverage.ts'

// Real Node filesystem (DocsFsLive) — proves real path resolution across
// directories, the one thing `makeTestDocsFs`'s in-memory map can't prove
// (CheckCoverage.unit.test.ts already covers every rule/orphan/exempt
// scenario against the in-memory layer).

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

const KINDS = [
  { id: 'feature', select: { by: 'path' as const, glob: '**/features/**' } },
  { id: 'decision', select: { by: 'path' as const, glob: '**/decisions/**' } },
]
const RULES = [{ from: 'feature', to: 'decision' }]

describe('checkCoverage() against the real filesystem (DocsFsLive)', () => {
  it('resolves a real cross-directory relative link and reports real coverage/orphan status', async () => {
    const p = project('checkcoverage-real', {
      'decisions/d1.md': '# Decision',
      'features/f1.md': '# Feature\n\n[why](../decisions/d1.md)',
    })
    const result = await run(checkCoverage({ base: p.root, kinds: KINDS, roots: [p.root], rules: RULES }))
    expect(result.checked).toBe(2)
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
  })

  it('reports a real missing-coverage feature and a real orphan decision', async () => {
    const p = project('checkcoverage-real-gaps', {
      'decisions/d1.md': '# Decision, nobody links here',
      'features/f1.md': '# Feature, no links at all',
    })
    const result = await run(checkCoverage({ base: p.root, kinds: KINDS, roots: [p.root], rules: RULES }))
    expect(result.missing).toEqual([
      {
        path: path.join(p.root, 'features/f1.md').split(path.sep).join('/'),
        rule: { from: 'feature', to: 'decision' },
      },
    ])
    expect(result.orphans).toEqual([
      { kinds: ['decision'], path: path.join(p.root, 'decisions/d1.md').split(path.sep).join('/') },
    ])
  })
})
