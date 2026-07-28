import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkCoverage, coverageExitCode, formatCoverageReport } from './CheckCoverage.ts'

const KINDS = [
  { id: 'feature', select: { by: 'path' as const, glob: '/r/features/**' } },
  { id: 'decision', select: { by: 'path' as const, glob: '/r/decisions/**' } },
]
const RULES = [{ from: 'feature', to: 'decision' }]

describe('checkCoverage()', () => {
  it('reports nothing when a feature links to a decision — real coverage', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(2) // both docs match a declared kind
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
    expect(coverageExitCode(result)).toBe(0)
  })

  it('never scans a non-.md file, even one under a declared kind glob', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/decisions/notes.txt': { content: 'not markdown at all', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: [] }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1) // notes.txt never counted
  })

  it('excludes a doc matching `ignore`, same as every sibling check', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/decisions/generated.md': { content: '# Generated, must be excluded', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        ignore: ['/r/decisions/generated.md'],
        kinds: KINDS,
        roots: ['/r'],
        rules: [],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
  })

  it('reports a feature with zero links to any decision as missing coverage', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature, no links at all', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }])
    expect(coverageExitCode(result)).toBe(1)
  })

  it('exempts a doc matching `exempt` from missing-coverage reporting too, not just orphan reporting', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/templates/blank.md': { content: '# Feature template, no links, intentionally', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        exempt: ['/r/features/templates/**'],
        kinds: KINDS,
        roots: ['/r'],
        rules: RULES,
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([])
  })

  it('a doc with SOME (not all) of its kinds being orphan-candidates is still orphan-checked', async () => {
    const mixedKinds = [...KINDS, { id: 'internal', select: { by: 'path' as const, glob: '/r/decisions/**' } }]
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision, also internal, nobody links here', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: mixedKinds, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    // d1.md matches BOTH 'decision' (an orphan-candidate, per RULES) and
    // 'internal' (not a candidate) — `.some`, not `.every`, decides
    // in-scope status, so it must still be reported.
    expect(result.orphans).toEqual([{ kinds: ['decision', 'internal'], path: '/r/decisions/d1.md' }])
  })

  it('a link to a doc that does NOT resolve to the required kind does not satisfy coverage', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[unrelated](../notes/other.md)', mtimeMs: 1 },
      '/r/notes/other.md': { content: '# Not a decision, and not a declared kind at all', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }])
  })

  // Orphan status only applies to a kind that's actually a rule's `to` side
  // (see CheckCoverage.ts's own comment) — "feature" here is a from-only
  // kind, never expected to be referenced back, so it must never appear in
  // `.orphans` even though nothing links to it either.
  it('reports a decision with zero inbound references from anywhere as orphaned, but never a from-only kind', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision, nobody links here', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.orphans).toEqual([{ kinds: ['decision'], path: '/r/decisions/d1.md' }])
  })

  // The referencing doc (`notes/random.md`) matches no declared kind at
  // all — its own reference must still count for the TARGET's inbound
  // graph, even though `random.md` itself is never reported on.
  it('an inbound reference from ANY doc (not just a rule-declared kind) clears orphan status', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/notes/random.md': { content: 'see [d1](../decisions/d1.md)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.orphans).toEqual([])
  })

  it('exempts a doc matching `exempt` from orphan reporting', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/templates/blank.md': { content: '# Template, intentionally unlinked', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        exempt: ['/r/decisions/templates/**'],
        kinds: KINDS,
        roots: ['/r'],
        rules: RULES,
      }).pipe(Effect.provide(layer)),
    )
    expect(result.orphans).toEqual([])
  })

  it('never flags a doc matching no declared kind as an orphan — only declared-kind docs are in scope', async () => {
    const layer = makeTestDocsFs({
      '/r/notes/random.md': { content: '# Random note, not a declared kind', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: [] }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(0) // matches no declared kind, out of scope entirely
    expect(result.orphans).toEqual([])
  })

  it('excludes a doc outside `trackedFiles`, same as every sibling check’s onlyGitTracked support', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/decisions/untracked.md': { content: '# Untracked, must be excluded entirely', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: KINDS,
        roots: ['/r'],
        rules: [],
        trackedFiles: new Set(['/r/decisions/d1.md']),
      }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
  })

  // Adversarial finding, not from the original TDD pass: an accidentally
  // (or programmatically) duplicated rule entry used to produce a
  // duplicate `missing` report line for the exact same violation — pure
  // noise, not a second real finding.
  it('reports a violation once, even when the SAME rule is declared twice', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: [...RULES, ...RULES] }).pipe(
        Effect.provide(layer),
      ),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }])
  })

  // Two GENUINELY DIFFERENT rules (sharing `from`, different `to`) must
  // never collapse into one — both violated here so losing EITHER would be
  // observable (a naive from/to dedup key that ignores `to`, or a bug that
  // only keeps the last-declared rule, would silently under-report).
  it('evaluates two different rules independently — both violations reported, neither lost', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature, no links at all', mtimeMs: 1 },
    })
    const twoRuleKinds = [...KINDS, { id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: twoRuleKinds,
        roots: ['/r'],
        rules: [
          { from: 'feature', to: 'decision' },
          { from: 'feature', to: 'spec' },
        ],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([
      { path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } },
      { path: '/r/features/f1.md', rule: { from: 'feature', to: 'spec' } },
    ])
  })

  // Adversarial finding: a chain of rules (feature -> decision -> spec) —
  // 'decision' is BOTH a rule.to (orphan-checkable) AND a rule.from (must
  // itself satisfy its own outbound rule). No special-casing needed; this
  // pins that the design already handles it correctly.
  it('handles a chained relation correctly — a kind that is both a rule.to and a rule.from', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision\n\n[spec](../specs/s1.md)', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
      '/r/specs/s1.md': { content: '# Spec', mtimeMs: 1 },
    })
    const chainKinds = [...KINDS, { id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: chainKinds,
        roots: ['/r'],
        rules: [...RULES, { from: 'decision', to: 'spec' }],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
  })

  // Adversarial finding: a direct rule must NOT be satisfied by an
  // indirect/transitive path — matches real traceability semantics (a
  // requirement citing a design doc that cites a test does not itself
  // count as the requirement citing the test).
  it('does not credit transitive coverage for a direct rule', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision\n\n[spec](../specs/s1.md)', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
      '/r/specs/s1.md': { content: '# Spec', mtimeMs: 1 },
    })
    const chainKinds = [...KINDS, { id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: chainKinds,
        roots: ['/r'],
        rules: [{ from: 'feature', to: 'spec' }], // direct feature->spec, never satisfied via decision
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'spec' } }])
  })

  // Adversarial finding: a same-kind cycle (d1 <-> d2) must not hang or
  // misbehave — proves this flat, non-recursive design has no loop-safety
  // concern the way a transitive/recursive structure engine would.
  it('handles a same-kind reference cycle without hanging or misreporting', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# D1\n\n[see](./d2.md)', mtimeMs: 1 },
      '/r/decisions/d2.md': { content: '# D2\n\n[see](./d1.md)', mtimeMs: 1 },
    })
    const selfKinds = [{ id: 'decision', select: { by: 'path' as const, glob: '/r/decisions/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: selfKinds,
        roots: ['/r'],
        rules: [{ from: 'decision', to: 'decision' }],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
  })
})

describe('coverageExitCode()', () => {
  it('is 0 when both missing and orphans are empty', () => {
    expect(coverageExitCode({ checked: 1, missing: [], orphans: [] })).toBe(0)
  })

  it('is 1 when only missing is non-empty (orphans empty)', () => {
    expect(
      coverageExitCode({ checked: 1, missing: [{ path: '/r/f.md', rule: { from: 'a', to: 'b' } }], orphans: [] }),
    ).toBe(1)
  })

  it('is 1 when only orphans is non-empty (missing empty)', () => {
    expect(coverageExitCode({ checked: 1, missing: [], orphans: [{ kinds: ['a'], path: '/r/d.md' }] })).toBe(1)
  })
})

describe('formatCoverageReport()', () => {
  it('reports OK with the checked count when both missing and orphans are empty', () => {
    expect(formatCoverageReport({ checked: 3, missing: [], orphans: [] })).toEqual([
      '✅ Coverage OK (3 doc(s) checked).',
    ])
  })

  it('lists every missing-coverage and orphan finding, exact wording', () => {
    const lines = formatCoverageReport({
      checked: 2,
      missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
      orphans: [{ kinds: ['decision'], path: '/r/decisions/d1.md' }],
    })
    expect(lines).toEqual([
      '❌ 1 doc(s) missing required coverage:',
      '  /r/features/f1.md',
      '    ✗ no link to a "decision"-kind doc (required by kind "feature")',
      '❌ 1 orphan doc(s) — no inbound reference from anywhere in the corpus:',
      '  /r/decisions/d1.md (decision)',
    ])
  })

  it('joins multiple kinds with ", " on an orphan finding — distinguishes from a bare concatenation', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [],
      orphans: [{ kinds: ['decision', 'internal'], path: '/r/decisions/d1.md' }],
    })
    expect(lines).toContain('  /r/decisions/d1.md (decision, internal)')
  })

  it('lists a missing-coverage finding with no orphan section at all when orphans is empty', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
      orphans: [],
    })
    expect(lines.some((l) => l.includes('/r/features/f1.md'))).toBeTruthy()
    expect(lines.some((l) => l.includes('orphan'))).toBeFalsy()
  })

  it('lists an orphan finding with no missing-coverage section at all when missing is empty', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [],
      orphans: [{ kinds: ['decision'], path: '/r/decisions/d1.md' }],
    })
    expect(lines.some((l) => l.includes('/r/decisions/d1.md'))).toBeTruthy()
    expect(lines.some((l) => l.includes('missing required coverage'))).toBeFalsy()
  })

  it('reports in French when locale is "fr" — both the OK line and every finding class', () => {
    expect(formatCoverageReport({ checked: 1, missing: [], orphans: [] }, { locale: 'fr' })).toEqual([
      '✅ Couverture OK (1 document(s) vérifié(s)).',
    ])
    const lines = formatCoverageReport(
      {
        checked: 2,
        missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
        orphans: [{ kinds: ['decision'], path: '/r/decisions/d1.md' }],
      },
      { locale: 'fr' },
    )
    expect(lines.some((l) => l.includes('sans la couverture requise'))).toBeTruthy()
    expect(lines.some((l) => l.includes('aucun lien vers un document de type'))).toBeTruthy()
    expect(lines.some((l) => l.includes('orphelin'))).toBeTruthy()
  })
})
