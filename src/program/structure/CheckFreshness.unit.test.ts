import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe } from 'vitest'

import { makeTestDocsFs } from '../../io/DocsFs.ts'
import { GitUnavailableError, makeTestGitFs } from '../../io/Git.ts'
import { checkFreshness, formatFreshnessReport, freshnessExitCode } from './CheckFreshness.ts'

const layers = (
  files: Record<string, { content: string; mtimeMs: number }>,
  lastCommitDates: ReadonlyMap<string, Date> | GitUnavailableError = new Map(),
) => Layer.merge(makeTestDocsFs(files), makeTestGitFs(new Set(), [], [], new Map(), [], lastCommitDates))

const RULES = [{ glob: 'docs/**', maxAgeDays: 30 }]
const NOW = new Date('2024-06-01T00:00:00.000Z')

const oldDocDates = new Map([['/r/docs/a.md', new Date('2024-01-01T00:00:00.000Z')]])

it.layer(layers({ '/r/docs/a.md': { content: '# A', mtimeMs: 1 } }, oldDocDates))(
  'checkFreshness() — a doc older than its matching rule maxAgeDays',
  (layerIt) => {
    layerIt.effect('reports it as stale', () =>
      Effect.gen(function* () {
        const result = yield* checkFreshness({ base: '/r', now: NOW, roots: ['/r/docs'], rules: RULES })
        expect(result.checked).toBe(1)
        expect(result.stale).toEqual([{ ageDays: 152, maxAgeDays: 30, path: '/r/docs/a.md' }])
        expect(result.noHistory).toBe(0)
        expect(freshnessExitCode(result)).toBe(1)
      }),
    )
  },
)

const recentDocDates = new Map([['/r/docs/a.md', new Date('2024-05-25T00:00:00.000Z')]])

it.layer(layers({ '/r/docs/a.md': { content: '# A', mtimeMs: 1 } }, recentDocDates))(
  'checkFreshness() — a doc within its matching rule maxAgeDays',
  (layerIt) => {
    layerIt.effect('does not report it as stale', () =>
      Effect.gen(function* () {
        const result = yield* checkFreshness({ base: '/r', now: NOW, roots: ['/r/docs'], rules: RULES })
        expect(result.stale).toEqual([])
        expect(freshnessExitCode(result)).toBe(0)
      }),
    )
  },
)

it.layer(layers({ '/r/other/a.md': { content: '# A', mtimeMs: 1 } }))(
  'checkFreshness() — a doc matching no rule glob at all',
  (layerIt) => {
    layerIt.effect('is skipped entirely, not counted or reported', () =>
      Effect.gen(function* () {
        const result = yield* checkFreshness({ base: '/r', now: NOW, roots: ['/r/other'], rules: RULES })
        expect(result.checked).toBe(0)
        expect(result.stale).toEqual([])
      }),
    )
  },
)

it.layer(layers({ '/r/docs/new.md': { content: '# New', mtimeMs: 1 } }))(
  'checkFreshness() — a doc with no commit history yet',
  (layerIt) => {
    layerIt.effect('counts it in noHistory and excludes it from stale', () =>
      Effect.gen(function* () {
        const result = yield* checkFreshness({ base: '/r', now: NOW, roots: ['/r/docs'], rules: RULES })
        expect(result.checked).toBe(1)
        expect(result.noHistory).toBe(1)
        expect(result.stale).toEqual([])
      }),
    )
  },
)

// 7 days old as of NOW (2024-06-01), relative to this commit date.
const adrDocDates = new Map([['/r/docs/adr/0001.md', new Date('2024-05-25T00:00:00.000Z')]])
const twoRulesLayer = layers({ '/r/docs/adr/0001.md': { content: '# ADR', mtimeMs: 1 } }, adrDocDates)

it.layer(twoRulesLayer)('checkFreshness() — two rules whose globs both match the same doc', (layerIt) => {
  layerIt.effect('the FIRST rule in declared order wins, not the most specific', () =>
    Effect.gen(function* () {
      const result = yield* checkFreshness({
        base: '/r',
        now: NOW,
        roots: ['/r/docs'],
        // `docs/**` (maxAgeDays: 1) is declared first, so it wins over the
        // more specific `docs/adr/**` (maxAgeDays: 365) declared second —
        // 7 days old exceeds the FIRST-matched rule's 1-day threshold.
        rules: [
          { glob: 'docs/**', maxAgeDays: 1 },
          { glob: 'docs/adr/**', maxAgeDays: 365 },
        ],
      })
      expect(result.stale).toEqual([{ ageDays: 7, maxAgeDays: 1, path: '/r/docs/adr/0001.md' }])
    }),
  )
})

it.layer(
  layers(
    { '/r/docs/a.md': { content: '# A', mtimeMs: 1 } },
    new GitUnavailableError({ base: '/r', message: 'no git' }),
  ),
)('checkFreshness() — git itself unavailable for a candidate path', (layerIt) => {
  layerIt.effect('treats it the same as no-history for that path, not a crash', () =>
    Effect.gen(function* () {
      const result = yield* checkFreshness({ base: '/r', now: NOW, roots: ['/r/docs'], rules: RULES })
      expect(result.checked).toBe(1)
      expect(result.noHistory).toBe(1)
      expect(result.stale).toEqual([])
    }),
  )
})

describe('formatFreshnessReport()', () => {
  it('reports OK with the checked count when nothing is stale', () => {
    const lines = formatFreshnessReport({ checked: 3, noHistory: 0, stale: [] })
    expect(lines.join('\n')).toContain('✅')
    expect(lines.join('\n')).toContain('3')
  })

  it('lists each stale doc with its age and threshold', () => {
    const lines = formatFreshnessReport({
      checked: 1,
      noHistory: 0,
      stale: [{ ageDays: 100, maxAgeDays: 30, path: '/r/docs/a.md' }],
    })
    const joined = lines.join('\n')
    expect(joined).toContain('/r/docs/a.md')
    expect(joined).toContain('100')
    expect(joined).toContain('30')
  })

  it('warns when EVERY checked doc came back with no git history', () => {
    const lines = formatFreshnessReport({ checked: 2, noHistory: 2, stale: [] })
    expect(lines.some((l) => l.includes('⚠️'))).toBeTruthy()
  })

  it('does not warn when only some checked docs have no git history', () => {
    const lines = formatFreshnessReport({ checked: 2, noHistory: 1, stale: [] })
    expect(lines.some((l) => l.includes('⚠️'))).toBeFalsy()
  })

  it('does not warn when checked is zero (nothing matched any rule)', () => {
    const lines = formatFreshnessReport({ checked: 0, noHistory: 0, stale: [] })
    expect(lines.some((l) => l.includes('⚠️'))).toBeFalsy()
  })
})
