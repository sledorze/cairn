// Real, if simple, proof for scripts/coverage-metrics.ts — the tool
// docs/design/CONVENTION.md's "Judging this convention" section now points to
// instead of hand-counting schema variants / hedge phrases by reading. Runs the
// actual counters against this repo's OWN real `src/core/Config.ts` and `docs/`
// tree (not a fixture) — the same "dogfood the actual thing" bar this repo holds
// every check-detection feature to (AGENTS.md's "Shipping one iteration well").

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { computeHedgeLanguageCensus, computeSchemaVariantCensus } from './coverage-metrics.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const configSource = fs.readFileSync(path.resolve(repoRoot, 'src/core/Config.ts'), 'utf8')

describe('schema variant census', () => {
  it('counts every current variant against the real Config.ts, all >= 1', () => {
    const census = computeSchemaVariantCensus(configSource)
    expect(census.kindSelectorVariants).toBeGreaterThanOrEqual(1)
    expect(census.coverageTargetVariants).toBeGreaterThanOrEqual(1)
    expect(census.coverageRequirementByVariants).toBeGreaterThanOrEqual(1)
    expect(census.coverageRuleScopeVariants).toBeGreaterThanOrEqual(1)
    expect(census.coverageRuleToVariants).toBeGreaterThanOrEqual(1)
    // Deliberately NOT pinned to an exact snapshot: these counts are meant to
    // change as the schema legitimately grows a new variant (that's the whole
    // point of tracking them as a number over time, per CONVENTION.md's
    // "Judging this convention" section) — a hardcoded exact match here would
    // make this test fail on every legitimate schema addition, for no real
    // safety gained over the `>= 1` / no-crash checks above.
    expect(Number.isInteger(census.kindSelectorVariants)).toBeTruthy()
    expect(Number.isInteger(census.coverageTargetVariants)).toBeTruthy()
  })

  it('throws a clear error for a declaration that does not exist, rather than miscounting', () => {
    expect(() => computeSchemaVariantCensus('const SomethingElse = 1\n')).toThrow(/could not find declaration/)
  })
})

describe('hedge language census', () => {
  it('produces a non-negative count per phrase and a matching total against the real docs/ tree', () => {
    const census = computeHedgeLanguageCensus(path.resolve(repoRoot, 'docs'))
    const sum = Object.values(census.perPhrase).reduce((total, n) => total + n, 0)
    expect(census.total).toBe(sum)
    for (const count of Object.values(census.perPhrase)) {
      expect(count).toBeGreaterThanOrEqual(0)
    }
    // CONVENTION.md itself names these phrases explicitly, so the real docs/
    // tree has at least one real hit today — a script that always reports 0
    // would be silently broken (e.g. wrong root, case-sensitivity bug).
    expect(census.total).toBeGreaterThan(0)
  })

  it('counts phrases case-insensitively and skips dotfile directories (e.g. .cairn/)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-metrics-hedge-'))
    try {
      fs.writeFileSync(path.join(dir, 'a.md'), 'This is NOT MODELED and also Out Of Scope.\n')
      fs.mkdirSync(path.join(dir, '.cairn'))
      fs.writeFileSync(path.join(dir, '.cairn', 'sidecar.md'), 'not modeled not modeled not modeled\n')
      const census = computeHedgeLanguageCensus(dir)
      expect(census.perPhrase['not modeled']).toBe(1)
      expect(census.perPhrase['out of scope']).toBe(1)
      expect(census.total).toBe(2)
    } finally {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  })
})
