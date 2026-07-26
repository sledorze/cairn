import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocsFs } from '../../io/DocsFs.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { checkProseRefs } from './CheckProseRefs.ts'

// Real-filesystem proof (issue #47), mirroring CheckLinks.integration.test.ts's
// discipline: the security boundary (never stat anything outside `base`) is
// only genuinely proven against a REAL file the host machine actually has,
// not an in-memory double that could accidentally "work" either way.

const run = <A>(eff: Effect.Effect<A, never, DocsFs>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeServices.layer)))

const checkDocs = (project: TempProject) =>
  run(checkProseRefs({ base: project.root, roots: [path.join(project.root, 'docs')] }))

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

describe('checkProseRefs() against the real filesystem (DocsFsLive)', () => {
  it('never stats/reads anything outside `base` — a real file on this host is still reported unverifiable, never trusted', async () => {
    expect(fs.existsSync('/etc/passwd')).toBeTruthy() // sanity: the test only proves something if this is true

    const p = project('proserefs-security', {
      // Deliberately does NOT start with `.` — a leading-dot citation is
      // already excluded as "not rooted" before this even runs (see
      // ProseRefs.unit.test.ts); this proves the DEEPER defense — an
      // embedded `../` escape inside an otherwise rooted-looking citation —
      // holds too.
      'docs/guide.md': 'See `x/../../../../../../../../etc/passwd` for details.',
    })
    const result = await checkDocs(p)
    const escape = result.broken[0]?.refs.find((r) => r.text === 'x/../../../../../../../../etc/passwd')
    expect(escape?.reason).toBe('unverifiable')
  })

  it('silent for a resolving citation, reports a genuinely moved/deleted one, real disk end to end', async () => {
    const p = project('proserefs-drift', {
      'docs/guide.md': [
        'See `src/services/auth.ts` for the real thing.',
        'Also `src/services/gone.ts`, moved away.',
      ].join('\n'),
      'src/services/auth.ts': 'export {}',
    })
    const result = await checkDocs(p)
    expect(result.broken).toHaveLength(1)
    const refs = result.broken[0]?.refs ?? []
    expect(refs.map((r) => r.text)).toEqual(['src/services/gone.ts'])
    expect(refs[0]?.suggestion).toBe('[`src/services/gone.ts`](../src/services/gone.ts)')
  })

  // False-positive sweep (issue #47's own stated requirement, criterion 6):
  // run the real checker against cairn's OWN real docs/ tree — a genuine,
  // non-synthetic corpus of prose written by a human, not by this feature's
  // own author trying to satisfy it. Any candidate found here that ISN'T a
  // real drifted reference would be a real false positive.
  it("false-positive sweep: flags nothing on cairn's own real docs/ tree", async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..')
    const result = await run(checkProseRefs({ base: repoRoot, roots: [path.join(repoRoot, 'docs')] }))
    if (result.broken.length > 0) {
      const detail = result.broken
        .flatMap((f) => f.refs.map((r) => `${f.file}: \`${r.text}\` (${r.reason})`))
        .join('\n')
      throw new Error(`false-positive sweep found unexpected candidates:\n${detail}`)
    }
    expect(result.broken).toEqual([])
  })
})
