import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, mergeConfig, parseRcJson } from './config.ts'

describe('mergeConfig()', () => {
  it('returns defaults for a non-object', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(mergeConfig(42)).toEqual(DEFAULT_CONFIG)
  })

  it('deep-merges naming and checks over the defaults', () => {
    const merged = mergeConfig({ checks: { links: false }, naming: { dirSummary: 'INDEX.md' } })
    expect(merged.naming.dirSummary).toBe('INDEX.md')
    expect(merged.naming.fileSummarySuffix).toBe('.summary.md')
    expect(merged.checks.links).toBeFalsy()
    expect(merged.checks.summaries).toBeTruthy()
  })

  it('ignores fields of the wrong type', () => {
    const merged = mergeConfig({ roots: 'docs', thresholdLines: 'many' })
    expect(merged.roots).toEqual(DEFAULT_CONFIG.roots)
    expect(merged.thresholdLines).toBe(DEFAULT_CONFIG.thresholdLines)
  })

  it('accepts a valid locale and rejects an invalid one', () => {
    expect(mergeConfig({ locale: 'fr' }).locale).toBe('fr')
    expect(mergeConfig({ locale: 'de' }).locale).toBe('en')
  })
})

describe('parseRcJson()', () => {
  it('parses valid JSON', () => {
    expect(parseRcJson('{"roots":["docs"]}', 'x.json')).toEqual({ roots: ['docs'] })
  })

  it('throws a clear, file-scoped message on malformed JSON', () => {
    expect(() => parseRcJson('{ not json', '/repo/.cairnrc.json')).toThrow(/invalid JSON in \/repo\/\.cairnrc\.json/)
  })
})
