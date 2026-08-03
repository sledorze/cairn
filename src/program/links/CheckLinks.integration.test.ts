import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocsFs } from '../../io/DocsFs.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
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
    // 'nope' has no case-insensitive match against guide.md's real anchors
    // ({'guide'}) — issue #49 only repairs an EXACT case-insensitive match,
    // so this one stays unfixed, still reported.
    expect(rewritten).toContain('[y](./guide.md#nope)')
  })

  // Issue #49: same proof shape as the path-repair test above, but for an
  // anchor differing from a real heading only by case — real disk, not the
  // in-memory double.
  it('--fix repairs a real anchor differing from a real heading only by case, on real disk', async () => {
    const p = project('checklinks-fix-anchor', {
      'docs/guide.md': '# Setup Pattern\n\ntext\n',
      'docs/index.md': '# Doc\n\n- [link](./guide.md#Setup-Pattern)\n',
    })

    const result = await checkDocs(p, true)
    expect(result.fixed).toBe(1)
    expect(result.broken).toEqual([])

    const rewritten = fs.readFileSync(path.join(p.root, 'docs', 'index.md'), 'utf8')
    expect(rewritten).toContain('[link](./guide.md#setup-pattern)')

    // Persisted and idempotent: re-checking the mutated file on real disk
    // finds nothing left to fix.
    const second = await checkDocs(p, true)
    expect(second.fixed).toBe(0)
    expect(second.broken).toEqual([])
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

  // Found via adversarial "no unhandled exception" review: a doc that
  // successfully LISTS but can't actually be READ (permission revoked, e.g.
  // `chmod 000`) crashed the whole run with a raw internal PlatformError
  // stack trace — `dfs.readFile` on the primary scan is `Effect.orDie`-
  // wrapped, so an ordinary, real-world-triggerable permission problem
  // reached the defect channel unguarded. Skipped when running as root
  // (bypasses Unix permission bits, so the failure this test exists to
  // prove wouldn't occur) or on Windows (`chmod` doesn't enforce POSIX bits).
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsPosixPermissions = process.platform !== 'win32' && !isRoot

  it.skipIf(!supportsPosixPermissions)(
    'a permission-denied doc is reported cleanly in `unreadable`, not a crash',
    async () => {
      const p = project('checklinks-unreadable', {
        'docs/a.md': '# ok',
        'docs/b.md': '# secret',
      })
      const bPath = path.join(p.root, 'docs', 'b.md')
      fs.chmodSync(bPath, 0o000)
      try {
        const result = await checkDocs(p)
        expect(result.unreadable).toEqual([bPath.replaceAll('\\', '/')])
        expect(result.checked).toBe(1) // only a.md was actually checked
        expect(result.broken).toEqual([])
      } finally {
        fs.chmodSync(bPath, 0o644)
      }
    },
  )

  // Adversarial finding, security-relevant (issue #28's PR, 4th review
  // pass): a symlink physically located INSIDE `base` can still point
  // OUTSIDE it — before this fix, a link through such a symlink reported
  // as resolved/non-broken, reproducing the exact filesystem-existence
  // oracle issue #39 was written to close, just reached through a path
  // that's lexically in-bounds instead of a literal `../` traversal.
  const supportsSymlinks = process.platform !== 'win32'

  it.skipIf(!supportsSymlinks)(
    'reports broken for a link through a symlink whose real target escapes `base`, even though its own path is lexically in-base',
    async () => {
      const p = project('checklinks-real-symlink', { 'docs/index.md': '[escape](../escape-link)' })
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklinks-real-symlink-outside-'))
      const secretFile = path.join(outsideDir, 'secret.txt')
      fs.writeFileSync(secretFile, 'not part of the repo')
      const linkPath = path.join(p.root, 'escape-link')
      try {
        fs.symlinkSync(secretFile, linkPath)
        const result = await checkDocs(p)
        expect(result.broken[0]?.links).toEqual([{ reason: 'path', target: '../escape-link', text: 'escape' }])
      } finally {
        fs.rmSync(outsideDir, { force: true, recursive: true })
      }
    },
  )

  // Adversarial finding (issue #28's PR, 5th review pass): `resolvePendingCheck`'s
  // `known.has(item.targetAbs)` fast path runs BEFORE the `realPath`
  // containment check just proven above, and used to trust it unconditionally
  // — reachable if a symlink escaping `base` had already been swept into
  // `known` (the scanned-doc universe) by `DocsFs.listFiles` itself. Now
  // that `listFiles`/`walk` (`DocsFs.ts`) excludes a symlink whose real
  // target falls outside every configured root at the SOURCE, `known` can
  // no longer contain such a path at all — this proves the fast path is
  // safe by construction, not by an independent second check here.
  it.skipIf(!supportsSymlinks)(
    'a symlinked doc escaping `roots` never enters `known` — a link targeting it is reported broken, not silently trusted',
    async () => {
      const p = project('checklinks-real-symlink-known', { 'docs/index.md': '[escape](./escaped.md)' })
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklinks-real-symlink-known-outside-'))
      const secretDoc = path.join(outsideDir, 'secret.md')
      fs.writeFileSync(secretDoc, '# Secret\n\n## Secret Section\n')
      const linkPath = path.join(p.root, 'docs', 'escaped.md')
      try {
        fs.symlinkSync(secretDoc, linkPath)
        const result = await checkDocs(p)
        // Never silently trusted via `known` — reported broken, same as
        // any other genuinely unresolvable target. If `known` had
        // wrongly absorbed the escaped symlink, this would report clean
        // instead (or, with an anchor, leak the secret doc's own real
        // heading into the report — see the `#`-anchor variant below).
        expect(result.broken[0]?.links).toEqual([{ reason: 'path', target: './escaped.md', text: 'escape' }])
      } finally {
        fs.rmSync(outsideDir, { force: true, recursive: true })
      }
    },
  )

  // Sharper variant: an anchor mismatch's error `detail` names the
  // target's REAL headings — if `known` had wrongly trusted the escaped
  // symlink, this is exactly where the secret file's own content would
  // leak into the JSON report.
  it.skipIf(!supportsSymlinks)(
    'never leaks a symlink-escaped target’s real headings into an anchor-mismatch detail',
    async () => {
      const p = project('checklinks-real-symlink-known-anchor', {
        'docs/index.md': '[escape](./escaped.md#no-such-section)',
      })
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklinks-real-symlink-known-anchor-outside-'))
      const secretDoc = path.join(outsideDir, 'secret.md')
      fs.writeFileSync(secretDoc, '# Secret\n\n## Top Secret Section\n')
      const linkPath = path.join(p.root, 'docs', 'escaped.md')
      try {
        fs.symlinkSync(secretDoc, linkPath)
        const result = await checkDocs(p)
        const broken = result.broken[0]?.links[0]
        expect(broken?.reason).toBe('path') // unresolvable at all, not an anchor mismatch
        expect(broken?.detail ?? '').not.toContain('top-secret-section')
        expect(broken?.detail ?? '').not.toContain('Top Secret')
      } finally {
        fs.rmSync(outsideDir, { force: true, recursive: true })
      }
    },
  )

  // Positive counterpart: a symlink whose real target stays INSIDE `base`
  // is a legitimate reference and must still resolve — proves this is a
  // containment check, not "reject every symlink."
  it.skipIf(!supportsSymlinks)('resolves a link through a symlink whose real target stays inside `base`', async () => {
    const p = project('checklinks-real-symlink-inside', {
      'docs/index.md': '[impl](../impl-link)',
      'src/real.ts': 'export const real = 1',
    })
    fs.symlinkSync(path.join(p.root, 'src/real.ts'), path.join(p.root, 'impl-link'))
    const result = await checkDocs(p)
    expect(result.broken).toEqual([])
  })
})
