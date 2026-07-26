import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocsFs } from '../../io/DocsFs.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { checkRefs, stampRefs } from './CheckRefs.ts'

// Real Node filesystem (DocsFsLive), matching CheckLinks.integration.test.ts's
// own discipline: the manual dogfooding proof (edit src/core/glob.ts, watch
// docs/architecture.md flip from "References OK" to "possibly stale," revert,
// confirm clean again) converted into a permanent, repeatable test instead of
// a one-shot manual run.

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

describe('stampRefs() / checkRefs() against the real filesystem (DocsFsLive)', () => {
  it('BEFORE/AFTER: stamped and clean, then a real edit to the referenced source file is caught as stale, then reverting clears it again', async () => {
    const p = project('checkrefs-drift', {
      'docs/index.md': '[core](../src/engine.ts)',
      'src/engine.ts': 'export const x = 1\n',
    })
    const args = { base: p.root, roots: [path.join(p.root, 'docs')] }

    const stampResult = await run(stampRefs(args))
    expect(stampResult.stamped).toBe(1)

    const before = await run(checkRefs(args))
    expect(before.checked).toBe(1)
    expect(before.stale).toEqual([])

    // A real, later change to the referenced file — same shape as editing
    // src/core/glob.ts underneath docs/architecture.md's real link.
    p.write('src/engine.ts', 'export const x = 2 // real change\n')

    const after = await run(checkRefs(args))
    expect(after.stale).toHaveLength(1)
    expect(after.stale[0]?.file).toBe(path.join(p.root, 'docs', 'index.md'))
    expect(after.stale[0]?.refs).toEqual([
      {
        currentHash: expect.any(String),
        recordedHash: expect.any(String),
        target: '../src/engine.ts',
      },
    ])
    expect(after.stale[0]?.refs[0]?.currentHash).not.toBe(after.stale[0]?.refs[0]?.recordedHash)

    p.write('src/engine.ts', 'export const x = 1\n')
    const reverted = await run(checkRefs(args))
    expect(reverted.stale).toEqual([])
  })

  it('tracks several real references in one doc independently — mirrors the real docs/architecture.md shape (10+ links in one file)', async () => {
    const p = project('checkrefs-multi', {
      'docs/guide.md': '# Guide\n\n## Getting Started\n',
      'docs/index.md': [
        '[a](../src/a.ts)',
        '[b](../src/b.ts)',
        '[c](../src/c.ts)',
        '[guide](./guide.md#getting-started)',
      ].join('\n'),
      'src/a.ts': 'export const a = 1\n',
      'src/b.ts': 'export const b = 1\n',
      'src/c.ts': 'export const c = 1\n',
    })
    const args = { base: p.root, roots: [path.join(p.root, 'docs')] }

    await run(stampRefs(args))
    const before = await run(checkRefs(args))
    expect(before.stale).toEqual([])

    // Change only b.ts on real disk — a.ts/c.ts/the guide anchor must stay silent.
    p.write('src/b.ts', 'export const b = 2 // changed\n')
    const afterB = await run(checkRefs(args))
    expect(afterB.stale).toHaveLength(1)
    expect(afterB.stale[0]?.refs.map((r) => r.target)).toEqual(['../src/b.ts'])

    // Now also change c.ts — both, and only both, drifted refs are reported,
    // each correctly paired with its own real hash.
    p.write('src/c.ts', 'export const c = 2 // also changed\n')
    const afterBoth = await run(checkRefs(args))
    const byTarget = new Map(afterBoth.stale[0]?.refs.map((r) => [r.target, r]))
    expect([...byTarget.keys()].toSorted()).toEqual(['../src/b.ts', '../src/c.ts'])
    expect(byTarget.get('../src/b.ts')?.currentHash).not.toBe(byTarget.get('../src/c.ts')?.currentHash)

    // Revert both — back to fully clean.
    p.write('src/b.ts', 'export const b = 1\n')
    p.write('src/c.ts', 'export const c = 1\n')
    const reverted = await run(checkRefs(args))
    expect(reverted.stale).toEqual([])
  })

  it("does not collide with _SUMMARY.md's own real freshness sidecar (the exact bug caught while dogfooding this feature)", async () => {
    const p = project('checkrefs-summary-collision', {
      '.cairn/docs/_SUMMARY.md.json': '{"sha256":"real-freshness-hash","version":1}',
      'docs/_SUMMARY.md': '- [architecture](./architecture.md)',
      'docs/architecture.md': '# Architecture',
    })
    await run(stampRefs({ base: p.root, roots: [path.join(p.root, 'docs')] }))

    const freshnessSidecarStillIntact = fs.readFileSync(path.join(p.root, '.cairn', 'docs', '_SUMMARY.md.json'), 'utf8')
    expect(freshnessSidecarStillIntact).toBe('{"sha256":"real-freshness-hash","version":1}')

    const refsSidecarPath = path.join(p.root, '.cairn', 'refs', 'docs', '_SUMMARY.md.json')
    expect(fs.existsSync(refsSidecarPath)).toBeTruthy()
  })
})
