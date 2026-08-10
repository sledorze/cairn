import { expect, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import type { DocsFs } from '../../io/DocsFs.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { GitFs } from '../../io/Git.ts'
import { makeTestGitFs } from '../../io/Git.ts'
import type { CheckCliFlags, CheckPlugin } from '../checks/CheckPlugin.ts'
import type { FreshnessResult } from './CheckFreshness.ts'
import { formatFreshnessReport, freshnessPlugin } from './CheckFreshness.ts'

const CLI: CheckCliFlags = {
  changed: [],
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

// Widened back to the full `CheckPlugin<FreshnessResult, DocsFs | GitFs>`
// interface shape purely for THIS test file's call sites — `freshnessPlugin`
// itself is declared with `satisfies` (not `:`), so its own inferred type is
// the narrower object literal (e.g. `isEnabled`'s single declared param),
// not the two-param interface every real caller (`runCheckPlugin.ts`) sees
// it through. Exercising it through the real interface here, matching how
// it's actually consumed in production.
const plugin: CheckPlugin<FreshnessResult, DocsFs | GitFs> = freshnessPlugin

describe('plugin.isEnabled()', () => {
  it('is disabled by default — checks.freshness defaults to null', () => {
    expect(plugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeFalsy()
  })

  it('is enabled exactly when checks.freshness is non-null — presence is the opt-in, no CLI flag', () => {
    const resolved = {
      ...DEFAULT_CONFIG,
      checks: { ...DEFAULT_CONFIG.checks, freshness: { rules: [] } },
    }
    expect(plugin.isEnabled(resolved, CLI)).toBeTruthy()
  })
})

test('plugin.jsonUnsupportedMessage matches its own opt-in message', () => {
  expect(plugin.jsonUnsupportedMessage).toBe('--json cannot be combined with checks.freshness yet')
})

test('plugin.name is "freshness"', () => {
  expect(plugin.name).toBe('freshness')
})

test('plugin.format() delegates to formatFreshnessReport()', () => {
  const result = { checked: 1, noHistory: 0, stale: [] }
  expect(plugin.format(result, { locale: 'en' })).toEqual(formatFreshnessReport(result, { locale: 'en' }))
})

test('freshnessPlugin has no stamp capability', () => {
  expect(plugin.stamp).toBeUndefined()
})

const emptyLayer = Layer.merge(makeTestDocsFs({}), makeTestGitFs(new Set()))

it.layer(emptyLayer)('freshnessPlugin.run() called with checks.freshness disabled', (layerIt) => {
  layerIt.effect('dies with a clear, named defect, not a raw destructure TypeError', () =>
    Effect.gen(function* () {
      const exit = yield* plugin
        .run({ base: '/r', cli: CLI, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBeTruthy()
      const message = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ''
      expect(message).toMatch(/FreshnessPluginMisuse.*checks\.freshness.*disabled/i)
    }),
  )
})

const RESOLVED_WITH_ONE_RULE = {
  ...DEFAULT_CONFIG,
  checks: { ...DEFAULT_CONFIG.checks, freshness: { rules: [{ glob: 'docs/**', maxAgeDays: 1 }] } },
}

const staleDocDates = new Map([['/r/docs/a.md', new Date('2020-01-01T00:00:00.000Z')]])
const staleDocLayer = Layer.merge(
  makeTestDocsFs({ '/r/docs/a.md': { content: '# A', mtimeMs: 1 } }),
  makeTestGitFs(new Set(), [], [], new Map(), [], staleDocDates),
)

it.layer(staleDocLayer)('freshnessPlugin.run() with a stale doc under a configured rule', (layerIt) => {
  layerIt.effect('actually reaches checkFreshness with the resolved rules', () =>
    Effect.gen(function* () {
      const result = yield* plugin.run({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: RESOLVED_WITH_ONE_RULE,
        roots: ['/r'],
      })
      expect(result.stale).toHaveLength(1)
      expect(result.stale[0]?.path).toBe('/r/docs/a.md')
    }),
  )
})

const twoDocsLayer = Layer.merge(
  makeTestDocsFs({
    '/r/docs/a.md': { content: '# A', mtimeMs: 1 },
    '/r/docs/b.md': { content: '# B', mtimeMs: 1 },
  }),
  makeTestGitFs(new Set(), [], [], new Map(), [], new Map()),
)

it.layer(twoDocsLayer)('freshnessPlugin.run() with trackedFiles narrowing the scanned universe', (layerIt) => {
  layerIt.effect('only counts the tracked doc, not every doc on disk', () =>
    Effect.gen(function* () {
      const result = yield* plugin.run({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: RESOLVED_WITH_ONE_RULE,
        roots: ['/r'],
        trackedFiles: new Set(['/r/docs/a.md']),
      })
      expect(result.checked).toBe(1)
    }),
  )
})
