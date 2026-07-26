import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocsFs } from '../io/DocsFs.ts'
import { DocsFsLive } from '../io/DocsFs.ts'
import type { TempProject } from '../testSupport/tempProject.ts'
import { makeTempProject } from '../testSupport/tempProject.ts'
import { checkLinks } from './CheckLinks.ts'

// Exercises the REAL Node filesystem binding (DocsFsLive) end to end for
// issue #39's anchor/cross-hierarchy/line-anchor/security scenarios — every
// other test of these scenarios uses the in-memory makeTestDocsFs double.
// This is the "did we actually prove it against real IO, not just a mock"
// check — first done by hand against a throwaway /tmp rig and the built
// dist/cli.js binary while dogfooding; converted here into a permanent,
// repeatable test rather than relying on that one-shot manual run.

const run = <A>(eff: Effect.Effect<A, never, DocsFs>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeServices.layer)))

const checkDocs = (project: TempProject, fix = false) =>
  run(checkLinks({ base: project.root, fix, roots: [path.join(project.root, 'docs')] }))

// Every project this file creates is torn down here — a single afterEach
// rather than one bespoke try/finally per test.
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

describe('checkLinks() against the real filesystem (DocsFsLive)', () => {
  const guideMd = [
    '# Guide',
    '',
    '## Getting Started',
    '',
    'Intro text.',
    '',
    '## API Reference',
    '',
    'Details.',
    '',
  ].join('\n')
  const indexMd = [
    '# Index',
    '',
    '- Cross-file anchor, real: [intro](./guide.md#getting-started)',
    '- Cross-file anchor, broken: [bad](./guide.md#not-a-real-section)',
    '- Same-page anchor, real: [jump](#local-section)',
    '- Same-page anchor, broken: [bad-local](#no-such-section)',
    '- Cross-hierarchy, real file, no anchor: [core](../src/core/engine.ts)',
    '- Cross-hierarchy, missing file: [ghost](../src/core/ghost.ts)',
    '- Cross-hierarchy, real file, valid line anchor: [line2](../src/core/engine.ts#L2)',
    '- Cross-hierarchy, real file, invalid line anchor: [line99](../src/core/engine.ts#L99)',
    '- Cross-hierarchy, symbol anchor (unverifiable, must not be flagged): [sym](../src/core/engine.ts#exportedThing)',
    '- Directory target with an anchor (must not crash): [libdir](../lib/#config)',
    "- Path traversal outside the checkout (must never be stat'd, always reported broken): [escape](../../../../../../../../etc/passwd)",
    '',
    '## Local Section',
    '',
    'Text.',
  ].join('\n')
  const engineTs = 'export const exportedThing = 1\nexport const another = 2\n'

  const scenarioProject = (): TempProject =>
    project('checklinks-scenarios', {
      'docs/guide.md': guideMd,
      'docs/index.md': indexMd,
      'lib/readme.md': '# lib readme\n',
      'src/core/engine.ts': engineTs,
    })

  it('correctly classifies every real scenario in one pass — B/C/E/F/G/security/directory-crash', async () => {
    const result = await checkDocs(scenarioProject())

    expect(result.broken).toHaveLength(1)
    const links = result.broken[0]?.links ?? []
    const byTarget = new Map(links.map((l) => [l.target, l]))

    // Genuinely broken — must be reported, each with its real reason.
    expect(byTarget.get('./guide.md#not-a-real-section')?.reason).toBe('anchor')
    expect(byTarget.get('#no-such-section')?.reason).toBe('anchor')
    expect(byTarget.get('../src/core/ghost.ts')?.reason).toBe('path')
    expect(byTarget.get('../src/core/engine.ts#L99')?.reason).toBe('line')
    expect(byTarget.get('../../../../../../../../etc/passwd')?.reason).toBe('path')

    // Genuinely fine, or unverifiable-by-design — must NOT be reported.
    expect(byTarget.has('./guide.md#getting-started')).toBeFalsy()
    expect(byTarget.has('#local-section')).toBeFalsy()
    expect(byTarget.has('../src/core/engine.ts')).toBeFalsy()
    expect(byTarget.has('../src/core/engine.ts#L2')).toBeFalsy()
    expect(byTarget.has('../src/core/engine.ts#exportedThing')).toBeFalsy() // scenario G
    expect(byTarget.has('../lib/#config')).toBeFalsy() // directory + anchor: no crash, unverifiable

    expect(links).toHaveLength(5)
  })

  it('never stats/reads anything outside `base` — the target genuinely exists on this machine, outside the checkout, and is still reported broken', async () => {
    // Corroborates the assertion above with the sharpest possible proof: this
    // is a REAL file that exists on the host running the test (not a mock),
    // resolving outside `base` — if the security boundary leaked, this would
    // be the one case that could silently pass instead of being flagged.
    expect(fs.existsSync('/etc/passwd')).toBeTruthy() // sanity: the test only proves something if this is true

    const result = await checkDocs(scenarioProject())
    const escape = result.broken[0]?.links.find((l) => l.target === '../../../../../../../../etc/passwd')
    expect(escape?.reason).toBe('path')
  })

  it('gives actionable detail for the real anchor/line failures, not just "broken"', async () => {
    const result = await checkDocs(scenarioProject())
    const links = result.broken[0]?.links ?? []
    const anchorFailure = links.find((l) => l.target === './guide.md#not-a-real-section')
    const lineFailure = links.find((l) => l.target === '../src/core/engine.ts#L99')
    expect(anchorFailure?.detail).toBe('available anchors: guide, getting-started, api-reference')
    expect(lineFailure?.detail).toBe('target has 3 lines')
  })

  it('--fix repairs a real renamed file on disk and leaves the file content otherwise untouched', async () => {
    const p = project('checklinks-fix', {
      'docs/guide.md': '# Guide\n',
      'docs/index.md': '# Doc\n\n- [x](./old-name.md)\n- [y](./guide.md#nope)\n',
      'docs/sub/old-name.md': '# Renamed target\n',
    })

    const result = await checkDocs(p, true)
    expect(result.fixed).toBe(1)
    expect(result.broken[0]?.links).toEqual([
      { detail: 'available anchors: guide', reason: 'anchor', target: './guide.md#nope', text: 'y' },
    ])

    const rewritten = fs.readFileSync(path.join(p.root, 'docs', 'index.md'), 'utf8')
    expect(rewritten).toContain('[x](./sub/old-name.md)')
    expect(rewritten).toContain('[y](./guide.md#nope)') // anchor break: never auto-fixed
  })

  // BEFORE/AFTER drift: a doc's links are correct when authored — the
  // property worth proving is that a LATER, real-world change (a rename, a
  // reworded heading, a shrunk file) is caught, with an error a human can
  // act on without opening the target — not just "it happens to pass today."
  // Each test: assert clean, mutate on disk exactly like a later commit
  // would, assert the specific drift is now caught with real detail, then
  // reverts and re-asserts clean — proving the check is live, not sticky.
  describe('drift: correct today, broken after a later real-world change', () => {
    it('catches a cross-hierarchy target being renamed', async () => {
      const p = project('checklinks-drift-rename', {
        'docs/index.md': '# Doc\n\n[core](../src/core/engine.ts)\n',
        'src/core/engine.ts': 'export const x = 1\n',
      })

      const before = await checkDocs(p)
      expect(before.broken).toEqual([])

      fs.renameSync(path.join(p.root, 'src', 'core', 'engine.ts'), path.join(p.root, 'src', 'core', 'renamed.ts'))
      const after = await checkDocs(p)
      expect(after.broken[0]?.links).toEqual([{ reason: 'path', target: '../src/core/engine.ts', text: 'core' }])

      fs.renameSync(path.join(p.root, 'src', 'core', 'renamed.ts'), path.join(p.root, 'src', 'core', 'engine.ts'))
      const reverted = await checkDocs(p)
      expect(reverted.broken).toEqual([])
    })

    it('catches a heading being reworded, with the real new slug in the detail', async () => {
      const p = project('checklinks-drift-heading', {
        'docs/guide.md': '# Guide\n\n## Getting Started\n',
        'docs/index.md': '# Doc\n\n[start](./guide.md#getting-started)\n',
      })

      const before = await checkDocs(p)
      expect(before.broken).toEqual([])

      p.write('docs/guide.md', '# Guide\n\n## Quick Start\n')
      const after = await checkDocs(p)
      expect(after.broken[0]?.links).toEqual([
        {
          detail: 'available anchors: guide, quick-start',
          reason: 'anchor',
          target: './guide.md#getting-started',
          text: 'start',
        },
      ])

      p.write('docs/guide.md', '# Guide\n\n## Getting Started\n')
      const reverted = await checkDocs(p)
      expect(reverted.broken).toEqual([])
    })

    it('catches a same-page table-of-contents link breaking when its own heading is reworded (the real docs/architecture.md case)', async () => {
      const p = project('checklinks-drift-toc', {
        'docs/index.md': '# Doc\n\n- [Layers](#layers)\n\n## Layers\n\nContent.\n',
      })

      const before = await checkDocs(p)
      expect(before.broken).toEqual([])

      p.write('docs/index.md', '# Doc\n\n- [Layers](#layers)\n\n## The Layers\n\nContent.\n')
      const after = await checkDocs(p)
      expect(after.broken[0]?.links).toEqual([
        { detail: 'available anchors: doc, the-layers', reason: 'anchor', target: '#layers', text: 'Layers' },
      ])

      p.write('docs/index.md', '# Doc\n\n- [Layers](#layers)\n\n## Layers\n\nContent.\n')
      const reverted = await checkDocs(p)
      expect(reverted.broken).toEqual([])
    })

    it('catches a target file shrinking below a referenced line anchor', async () => {
      const p = project('checklinks-drift-lines', {
        'docs/index.md': '# Doc\n\n[here](../src/big.ts#L5)\n',
        'src/big.ts': 'a\nb\nc\nd\ne\nf\n',
      })

      const before = await checkDocs(p)
      expect(before.broken).toEqual([])

      p.write('src/big.ts', 'a\nb\n')
      const after = await checkDocs(p)
      expect(after.broken[0]?.links).toEqual([
        { detail: 'target has 3 lines', reason: 'line', target: '../src/big.ts#L5', text: 'here' },
      ])

      p.write('src/big.ts', 'a\nb\nc\nd\ne\nf\n')
      const reverted = await checkDocs(p)
      expect(reverted.broken).toEqual([])
    })
  })
})
