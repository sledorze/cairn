import { Either } from 'effect'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, decodeConfig, formatConfigError } from './Config.ts'

// `decodeConfig` is total and pure: it never throws (it's `effect/Schema` under a thin
// wrapper — Schema already hands back an `Either`, so collapsing that into a thrown
// exception inside a module documented as "no IO, pure decision logic" would be a purity
// leak). Unknown keys and wrong-typed values are rejected via a `Left`, never silently
// ignored (`onExcessProperty: 'error'`) — a config guarantee that quietly ignores a typo
// isn't a guarantee. Formatting a `Left` into a human-readable, file-scoped message is a
// separate, equally pure concern (`formatConfigError`) — decoding has no business knowing
// which file it came from; that's the caller's context, not the decoder's.
describe('decodeConfig()', () => {
  it('decodes an empty object to a Right of an empty object (defaults apply at resolution time, not here)', () => {
    const result = decodeConfig({})
    expect(Either.isRight(result)).toBeTruthy()
    expect(Either.getOrThrow(result)).toEqual({})
  })

  it('decodes only the fields present, leaving the rest absent (partial by design)', () => {
    const result = decodeConfig({ checks: { links: false }, naming: { dirSummary: 'INDEX.md' } })
    expect(Either.getOrThrow(result)).toEqual({ checks: { links: false }, naming: { dirSummary: 'INDEX.md' } })
  })

  it('returns a Left (never throws) on a non-object', () => {
    expect(Either.isLeft(decodeConfig(42))).toBeTruthy()
    expect(Either.isLeft(decodeConfig(null))).toBeTruthy()
  })

  it('returns a Left on an unknown top-level key instead of silently ignoring it', () => {
    expect(Either.isLeft(decodeConfig({ thresholdLins: 10 }))).toBeTruthy()
  })

  it('returns a Left on a nested unknown key (inside `checks`/`naming`) instead of silently ignoring it', () => {
    expect(Either.isLeft(decodeConfig({ checks: { linkz: true } }))).toBeTruthy()
    expect(Either.isLeft(decodeConfig({ naming: { dirSummari: 'x' } }))).toBeTruthy()
  })

  it('returns a Left on a wrong-typed field instead of silently reverting to the default', () => {
    expect(Either.isLeft(decodeConfig({ roots: 'docs' }))).toBeTruthy()
    expect(Either.isLeft(decodeConfig({ thresholdLines: 'many' }))).toBeTruthy()
  })

  it('accepts a valid locale and rejects an invalid one', () => {
    expect(Either.getOrThrow(decodeConfig({ locale: 'fr' })).locale).toBe('fr')
    expect(Either.isLeft(decodeConfig({ locale: 'de' }))).toBeTruthy()
  })

  it('accepts `$schema` (the JSON Schema meta-property IDEs read) as inert', () => {
    expect(Either.getOrThrow(decodeConfig({ $schema: './schema.json' }))).toEqual({ $schema: './schema.json' })
  })

  // "Parse, don't validate": `extends` is a string OR an array in the raw JSON (for
  // ergonomics — a single preset shouldn't force array syntax), but the decoded value is
  // ALWAYS an array. The union is collapsed once, at the parse boundary, so every
  // downstream consumer works with one shape instead of re-deriving it ad hoc.
  describe('`extends` — normalized to an array at decode time', () => {
    it('accepts a bare string and normalizes it to a one-element array', () => {
      expect(Either.getOrThrow(decodeConfig({ extends: './base.json' })).extends).toEqual(['./base.json'])
    })

    it('accepts an array as-is', () => {
      expect(Either.getOrThrow(decodeConfig({ extends: ['./a.json', './b.json'] })).extends).toEqual([
        './a.json',
        './b.json',
      ])
    })

    it('is absent (not an empty array) when not specified', () => {
      expect(Either.getOrThrow(decodeConfig({})).extends).toBeUndefined()
    })
  })

  // "Make illegal states unrepresentable": thresholdLines is compared as `lineCount >
  // thresholdLines` (core/DocSummaries.ts) — negative or fractional values are
  // nonsensical, not just unusual. Reject them at the type/schema level rather than
  // letting a bad value silently misbehave downstream.
  describe('thresholdLines — non-negative integer only', () => {
    it('accepts zero and positive integers', () => {
      expect(Either.getOrThrow(decodeConfig({ thresholdLines: 0 })).thresholdLines).toBe(0)
      expect(Either.getOrThrow(decodeConfig({ thresholdLines: 50 })).thresholdLines).toBe(50)
    })

    it('rejects a negative value', () => {
      expect(Either.isLeft(decodeConfig({ thresholdLines: -5 }))).toBeTruthy()
    })

    it('rejects a fractional value', () => {
      expect(Either.isLeft(decodeConfig({ thresholdLines: 3.7 }))).toBeTruthy()
    })
  })
})

describe('formatConfigError()', () => {
  it('renders a Left into a clear, file-scoped, actionable message', () => {
    const result = decodeConfig({ thresholdLins: 10 })
    if (Either.isRight(result)) {
      throw new Error('expected a Left')
    }
    expect(formatConfigError(result.left, '/repo/.cairnrc.json')).toMatch(/invalid config in \/repo\/\.cairnrc\.json/)
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
