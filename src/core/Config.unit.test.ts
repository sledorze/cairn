import { Result } from 'effect'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, decodeConfig, formatConfigError } from './Config.ts'

// `decodeConfig` is total and pure over its actual domain — any value JSON.parse can
// produce — and never throws for it: `effect/Schema` already hands back a `Result`, so
// collapsing that into a thrown exception inside a module documented as "no IO, pure
// decision logic" would be a purity leak. Unknown keys and wrong-typed values are
// rejected via a `Failure`, never silently ignored (`onExcessProperty: 'error'`) — a config
// guarantee that quietly ignores a typo isn't a guarantee. Formatting a `Failure` into a
// human-readable, file-scoped message is a separate, equally pure concern
// (`formatConfigError`) — decoding has no business knowing which file it came from;
// that's the caller's context, not the decoder's.
describe('decodeConfig()', () => {
  it('decodes an empty object to a Success of an empty object (defaults apply at resolution time, not here)', () => {
    const result = decodeConfig({})
    expect(Result.isSuccess(result)).toBeTruthy()
    expect(Result.getOrThrow(result)).toEqual({})
  })

  it('decodes only the fields present, leaving the rest absent (partial by design)', () => {
    const result = decodeConfig({ checks: { links: false }, naming: { dirSummary: 'INDEX.md' } })
    expect(Result.getOrThrow(result)).toEqual({ checks: { links: false }, naming: { dirSummary: 'INDEX.md' } })
  })

  it('returns a Failure (never throws) on a non-object', () => {
    expect(Result.isFailure(decodeConfig(42))).toBeTruthy()
    expect(Result.isFailure(decodeConfig(null))).toBeTruthy()
  })

  it('returns a Failure (never throws) on a circular-referencing object', () => {
    // Not something JSON.parse can produce, but a careless caller of this public API
    // could construct one — decodeConfig is total over any value shaped like this,
    // just not over pathological values with side-effecting property access (out of
    // scope; see the decodeConfig docstring).
    const circular: Record<string, unknown> = { thresholdLines: 5 }
    circular['self'] = circular
    expect(Result.isFailure(decodeConfig(circular))).toBeTruthy()
  })

  it('returns a Failure on an unknown top-level key instead of silently ignoring it', () => {
    expect(Result.isFailure(decodeConfig({ thresholdLins: 10 }))).toBeTruthy()
  })

  it('returns a Failure on a nested unknown key (inside `checks`/`naming`) instead of silently ignoring it', () => {
    expect(Result.isFailure(decodeConfig({ checks: { linkz: true } }))).toBeTruthy()
    expect(Result.isFailure(decodeConfig({ naming: { dirSummari: 'x' } }))).toBeTruthy()
  })

  it('returns a Failure on a wrong-typed field instead of silently reverting to the default', () => {
    expect(Result.isFailure(decodeConfig({ roots: 'docs' }))).toBeTruthy()
    expect(Result.isFailure(decodeConfig({ thresholdLines: 'many' }))).toBeTruthy()
  })

  it('accepts a valid locale and rejects an invalid one', () => {
    expect(Result.getOrThrow(decodeConfig({ locale: 'fr' })).locale).toBe('fr')
    expect(Result.isFailure(decodeConfig({ locale: 'de' }))).toBeTruthy()
  })

  it('accepts `$schema` (the JSON Schema meta-property IDEs read) as inert', () => {
    expect(Result.getOrThrow(decodeConfig({ $schema: './schema.json' }))).toEqual({ $schema: './schema.json' })
  })

  // "Parse, don't validate": `extends` is a string OR an array in the raw JSON (for
  // ergonomics — a single preset shouldn't force array syntax), but the decoded value is
  // ALWAYS an array. The union is collapsed once, at the parse boundary, so every
  // downstream consumer works with one shape instead of re-deriving it ad hoc.
  describe('`extends` — normalized to an array at decode time', () => {
    it('accepts a bare string and normalizes it to a one-element array', () => {
      expect(Result.getOrThrow(decodeConfig({ extends: './base.json' })).extends).toEqual(['./base.json'])
    })

    it('accepts an array as-is', () => {
      expect(Result.getOrThrow(decodeConfig({ extends: ['./a.json', './b.json'] })).extends).toEqual([
        './a.json',
        './b.json',
      ])
    })

    it('is absent (not an empty array) when not specified', () => {
      expect(Result.getOrThrow(decodeConfig({})).extends).toBeUndefined()
    })
  })

  // "Make illegal states unrepresentable": thresholdLines is compared as `lineCount >
  // thresholdLines` (core/DocSummaries.ts) — negative or fractional values are
  // nonsensical, not just unusual. Reject them at the type/schema level rather than
  // letting a bad value silently misbehave downstream.
  describe('thresholdLines — non-negative integer only', () => {
    it('accepts zero and positive integers', () => {
      expect(Result.getOrThrow(decodeConfig({ thresholdLines: 0 })).thresholdLines).toBe(0)
      expect(Result.getOrThrow(decodeConfig({ thresholdLines: 50 })).thresholdLines).toBe(50)
    })

    it('rejects a negative value', () => {
      expect(Result.isFailure(decodeConfig({ thresholdLines: -5 }))).toBeTruthy()
    })

    it('rejects a fractional value', () => {
      expect(Result.isFailure(decodeConfig({ thresholdLines: 3.7 }))).toBeTruthy()
    })
  })
})

describe('formatConfigError()', () => {
  it('renders a Failure into a clear, file-scoped, actionable message', () => {
    const result = decodeConfig({ thresholdLins: 10 })
    if (Result.isSuccess(result)) {
      throw new Error('expected a Failure')
    }
    expect(formatConfigError(result.failure, '/repo/.cairnrc.json')).toMatch(
      /invalid config in \/repo\/\.cairnrc\.json/,
    )
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
