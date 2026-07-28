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
})

describe('formatCoverageReport()', () => {
  it('reports OK with the checked count when both missing and orphans are empty', () => {
    expect(formatCoverageReport({ checked: 3, missing: [], orphans: [] })).toEqual([
      '✅ Coverage OK (3 doc(s) checked).',
    ])
  })

  it('lists every missing-coverage and orphan finding', () => {
    const lines = formatCoverageReport({
      checked: 2,
      missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
      orphans: [{ kinds: ['decision'], path: '/r/decisions/d1.md' }],
    })
    expect(lines.some((l) => l.includes('/r/features/f1.md'))).toBeTruthy()
    expect(lines.some((l) => l.includes('/r/decisions/d1.md'))).toBeTruthy()
  })
})
