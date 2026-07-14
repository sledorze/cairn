import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, decodeConfig } from './Config.ts'

// `decodeConfig` is the strict, effect/Schema-driven per-layer decoder: every field is
// optional (a config file only specifies what it overrides), unknown keys are rejected
// (onExcessProperty: 'error'), and wrong-typed values are rejected rather than silently
// falling back to the default — a silently-wrong config would undermine cairn's own
// thesis (a CI *guarantee* that quietly ignores typos isn't one).
describe('decodeConfig()', () => {
  it('decodes an empty object to an empty object (defaults are applied at resolution time, not here)', () => {
    expect(decodeConfig({}, 'x.json')).toEqual({})
  })

  it('decodes only the fields present, leaving the rest absent (partial by design)', () => {
    const decoded = decodeConfig({ checks: { links: false }, naming: { dirSummary: 'INDEX.md' } }, 'x.json')
    expect(decoded).toEqual({ checks: { links: false }, naming: { dirSummary: 'INDEX.md' } })
  })

  it('rejects a non-object with a clear, file-scoped error', () => {
    expect(() => decodeConfig(42, '/repo/.cairnrc.json')).toThrow(/invalid config in \/repo\/\.cairnrc\.json/)
    expect(() => decodeConfig(null, '/repo/.cairnrc.json')).toThrow(/invalid config in \/repo\/\.cairnrc\.json/)
  })

  it('rejects an unknown top-level key instead of silently ignoring it', () => {
    expect(() => decodeConfig({ thresholdLins: 10 }, '/repo/.cairnrc.json')).toThrow(
      /invalid config in \/repo\/\.cairnrc\.json/,
    )
  })

  it('rejects a nested unknown key (inside `checks`/`naming`) instead of silently ignoring it', () => {
    expect(() => decodeConfig({ checks: { linkz: true } }, 'x.json')).toThrow(/invalid config in/)
    expect(() => decodeConfig({ naming: { dirSummari: 'x' } }, 'x.json')).toThrow(/invalid config in/)
  })

  it('rejects a wrong-typed field instead of silently reverting to the default', () => {
    expect(() => decodeConfig({ roots: 'docs' }, '/repo/.cairnrc.json')).toThrow(/invalid config in/)
    expect(() => decodeConfig({ thresholdLines: 'many' }, '/repo/.cairnrc.json')).toThrow(/invalid config in/)
  })

  it('accepts a valid locale and rejects an invalid one', () => {
    expect(decodeConfig({ locale: 'fr' }, 'x.json').locale).toBe('fr')
    expect(() => decodeConfig({ locale: 'de' }, 'x.json')).toThrow(/invalid config in/)
  })

  it('accepts a single `extends` string or an array of them', () => {
    expect(decodeConfig({ extends: './base.json' }, 'x.json').extends).toBe('./base.json')
    expect(decodeConfig({ extends: ['./a.json', './b.json'] }, 'x.json').extends).toEqual(['./a.json', './b.json'])
  })

  it('accepts `$schema` (the JSON Schema meta-property IDEs read) as inert', () => {
    expect(decodeConfig({ $schema: './schema.json' }, 'x.json')).toEqual({ $schema: './schema.json' })
  })
})

describe('the built-in defaults', () => {
  it('matches the documented defaults', () => {
    expect(DEFAULT_CONFIG).toEqual({
      checks: { links: true, summaries: true },
      ignore: ['**/node_modules/**'],
      locale: 'en',
      naming: { dirSummary: '_SUMMARY.md', fileSummarySuffix: '.summary.md' },
      requireDirSummaries: true,
      roots: ['docs'],
      stampCommand: 'npx cairn check --summaries-only --stamp',
      thresholdLines: 30,
    })
  })
})
