import { Effect } from 'effect'
import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { coveragePlugin, formatCoverageReport } from './CheckCoverage.ts'

const CLI: CheckCliFlags = {
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

describe('coveragePlugin.isEnabled()', () => {
  it('is disabled by default — checks.coverage defaults to null', () => {
    expect(coveragePlugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeFalsy()
  })

  it('is enabled exactly when checks.coverage is non-null — presence is the opt-in, no CLI flag', () => {
    const resolved = {
      ...DEFAULT_CONFIG,
      checks: { ...DEFAULT_CONFIG.checks, coverage: { exempt: [], kinds: [], rules: [] } },
    }
    expect(coveragePlugin.isEnabled(resolved, CLI)).toBeTruthy()
  })
})

test('coveragePlugin.jsonUnsupportedMessage matches cli.ts’s exact prior message', () => {
  expect(coveragePlugin.jsonUnsupportedMessage).toBe('--json cannot be combined with checks.coverage yet')
})

test('coveragePlugin.name is "coverage"', () => {
  expect(coveragePlugin.name).toBe('coverage')
})

// Adversarial finding: `run` used to trust `isEnabled` was already checked
// via an unguarded `as CoverageConfig` cast — safe through the real
// runner (runCheckPlugin.ts always checks isEnabled first), but any OTHER
// caller (a test, a script, a future 6th plugin copying this pattern) that
// calls `.run()` directly with `checks.coverage` disabled got a raw,
// unhelpful `TypeError: Cannot destructure property 'exempt' of 'null'`
// instead of a clear, named failure. Fixed to fail loudly and clearly
// instead — still a defect (this is a genuine "should never happen through
// the real runner" precondition violation, not a recoverable error), but a
// legible one.
test('run() fails with a clear, named error (not a raw destructure TypeError) when called with checks.coverage disabled', async () => {
  const layer = makeTestDocsFs({})
  const effect = coveragePlugin
    .run({ base: '/r', cli: CLI, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] })
    .pipe(Effect.provide(layer))
  await expect(Effect.runPromise(effect)).rejects.toThrow(/coveragePlugin\.run.*checks\.coverage.*disabled/i)
})

test('coveragePlugin.format() delegates to formatCoverageReport()', () => {
  const result = { checked: 1, emptyScopeUnders: [], missing: [], orphans: [], unmatchedKinds: [] }
  expect(coveragePlugin.format(result, { locale: 'en' })).toEqual(formatCoverageReport(result, { locale: 'en' }))
})

test('coveragePlugin has no stamp capability', () => {
  expect(coveragePlugin.stamp).toBeUndefined()
})

// Real end-to-end wiring check, not just isEnabled/name plumbing: `run`
// must actually pull kinds/rules/exempt out of `resolved.checks.coverage`
// and reach a real result — a wiring bug here (e.g. forgetting to pass
// `rules`) would silently make coverage always report nothing.
test('coveragePlugin.run() actually reaches checkCoverage with the resolved kinds/rules', async () => {
  const layer = makeTestDocsFs({
    '/r/decisions/d1.md': { content: '# Decision, nobody links here', mtimeMs: 1 },
    '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
  })
  const resolved = {
    ...DEFAULT_CONFIG,
    checks: {
      ...DEFAULT_CONFIG.checks,
      coverage: {
        exempt: [],
        kinds: [
          { id: 'feature', select: { by: 'path' as const, glob: '/r/features/**' } },
          { id: 'decision', select: { by: 'path' as const, glob: '/r/decisions/**' } },
        ],
        rules: [{ from: 'feature', to: 'decision' }],
      },
    },
  }
  const result = await Effect.runPromise(
    coveragePlugin.run({ base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'] }).pipe(Effect.provide(layer)),
  )
  expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }])
})

test('coveragePlugin.run() also reaches checkCoverage with trackedFiles narrowing the scanned universe', async () => {
  const layer = makeTestDocsFs({
    '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    // A SECOND feature-kind doc, deliberately left OUT of `trackedFiles` —
    // proves the ternary at the trackedFiles call site actually threads
    // through and excludes it, rather than always scanning everything
    // (which a mutated `trackedFiles === undefined ? {} : {}` — dropping
    // the spread entirely — would silently still pass with only 1 doc).
    '/r/features/untracked.md': { content: '# Untracked feature, must be excluded', mtimeMs: 1 },
  })
  const resolved = {
    ...DEFAULT_CONFIG,
    checks: {
      ...DEFAULT_CONFIG.checks,
      coverage: {
        exempt: [],
        kinds: [{ id: 'feature', select: { by: 'path' as const, glob: '/r/features/**' } }],
        rules: [],
      },
    },
  }
  const result = await Effect.runPromise(
    coveragePlugin
      .run({ base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'], trackedFiles: new Set(['/r/features/f1.md']) })
      .pipe(Effect.provide(layer)),
  )
  expect(result.checked).toBe(1)
})
