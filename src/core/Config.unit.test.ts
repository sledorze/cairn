import { Result } from 'effect'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, decodeConfig, formatConfigError, isKindTarget } from './Config.ts'

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

  it('decodes `checks.coverage` — presence itself is the opt-in, no separate `enabled` field', () => {
    const raw = {
      checks: {
        coverage: {
          kinds: [
            {
              description: 'A product feature doc.',
              id: 'feature',
              select: { by: 'path', glob: 'product/features/**' },
            },
            { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
          ],
          rules: [{ from: 'feature', to: 'decision' }],
        },
      },
    }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  // A kind id (`design-package`, `spikes`) isn't self-explanatory to a
  // reader unfamiliar with a repo's own convention, unlike a rule's
  // auto-generated report line — no fallback exists for a kind the way an
  // unnamed rule's message already explains itself, so `description` is
  // unconditionally required here (unlike `CoverageRule.description`,
  // mandatory only when `name` is set).
  it('returns a Failure when a kind has no `description`', () => {
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [{ id: 'feature', select: { by: 'path', glob: 'product/features/**' } }],
              rules: [],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  it('decodes `checks.coverage.exempt` when present', () => {
    const raw = { checks: { coverage: { exempt: ['product/features/templates/**'], kinds: [], rules: [] } } }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  // Adversarial finding: `links`/`summaries` can be turned back off with a
  // plain `false`, letting a descendant config override an inherited
  // `extends` preset — `checks.coverage` had no equivalent, only whole-
  // object replacement, so once a preset enabled it there was no way for a
  // descendant to opt back out short of setting `kinds`/`rules` to empty
  // arrays (which still leaves it enabled, just vacuously).
  it('decodes `checks.coverage: false` — an explicit re-disable, distinct from omitting the key entirely', () => {
    const raw = { checks: { coverage: false as const } }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  it('decodes a rule’s optional `name` — the discriminant for two rules sharing a kind pair', () => {
    const raw = {
      checks: {
        coverage: {
          kinds: [
            { description: 'A specification doc.', id: 'spec', select: { by: 'path', glob: 'docs/spec/**' } },
            { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
          ],
          rules: [
            {
              description: 'A spec must cite the decision it implements.',
              from: 'spec',
              name: 'implements',
              to: 'decision',
            },
          ],
        },
      },
    }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  // A named rule with no `description` doesn't just look incomplete — it
  // silently reintroduces the exact "bare label, no guidance" gap
  // `description` was added to close. Caught at decode time, not left to
  // authorial discipline.
  it('returns a Failure when a rule has `name` but no `description`', () => {
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                { description: 'A specification doc.', id: 'spec', select: { by: 'path', glob: 'docs/spec/**' } },
                { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
              ],
              rules: [{ from: 'spec', name: 'implements', to: 'decision' }],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  // The refuted alternative: `description` is NOT mandatory for every rule,
  // only named ones — an unnamed rule's report line is already
  // self-explanatory ("no link to a 'decision'-kind doc"); forcing a
  // description there would just be restated filler.
  it('does NOT require `description` on an unnamed rule', () => {
    const raw = {
      checks: {
        coverage: {
          kinds: [
            { description: 'A specification doc.', id: 'spec', select: { by: 'path', glob: 'docs/spec/**' } },
            { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
          ],
          rules: [{ from: 'spec', to: 'decision' }],
        },
      },
    }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  it('decodes a rule’s optional `via` — the discriminant for how the rule is satisfied (only `by: "link"` today)', () => {
    const raw = {
      checks: {
        coverage: {
          kinds: [
            {
              description: 'A product feature doc.',
              id: 'feature',
              select: { by: 'path', glob: 'product/features/**' },
            },
            { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
          ],
          rules: [{ from: 'feature', to: 'decision', via: { by: 'link' } }],
        },
      },
    }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  it('returns a Failure when a rule’s `via.by` is not the recognised `"link"` literal', () => {
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                {
                  description: 'A product feature doc.',
                  id: 'feature',
                  select: { by: 'path', glob: 'product/features/**' },
                },
                { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
              ],
              rules: [{ from: 'feature', to: 'decision', via: { by: 'backlink' } }],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  // Closes a real, verified capturability gap: a wildcard `to`-kind glob
  // matching many instances (e.g. every design package's own spikes.md) lets
  // one instance's rule be satisfied by a DIFFERENT instance's sibling doc.
  // See docs/design/CONVENTION.md's own "Is any of this actually
  // capturable?" finding.
  it('decodes a rule’s optional `scope: "sibling"`', () => {
    const raw = {
      checks: {
        coverage: {
          kinds: [
            {
              description: 'A roadmap doc.',
              id: 'roadmap',
              select: { by: 'path', glob: '**/docs/design/*/roadmap.md' },
            },
            {
              description: 'A feasibility-spike doc.',
              id: 'spikes',
              select: { by: 'path', glob: '**/docs/design/*/spikes.md' },
            },
          ],
          rules: [{ from: 'roadmap', scope: 'sibling', to: 'spikes' }],
        },
      },
    }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  it('returns a Failure when a rule’s `scope` is not the recognised `"sibling"` literal', () => {
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                {
                  description: 'A product feature doc.',
                  id: 'feature',
                  select: { by: 'path', glob: 'product/features/**' },
                },
                { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
              ],
              rules: [{ from: 'feature', scope: 'directory', to: 'decision' }],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  it('returns a Failure on an unknown key inside `checks.coverage` or a kind selector', () => {
    expect(Result.isFailure(decodeConfig({ checks: { coverage: { kinds: [], rulez: [] } } }))).toBeTruthy()
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                { description: 'A placeholder kind for this test.', id: 'x', select: { by: 'path', globb: '*' } },
              ],
              rules: [],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  it('returns a Failure when `checks.coverage.select.by` is not the recognised `"path"` literal', () => {
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                { description: 'A placeholder kind for this test.', id: 'x', select: { by: 'frontmatter', glob: '*' } },
              ],
              rules: [],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  // A rule referencing a kind id that's never declared is a config typo that would
  // otherwise deterministically report every `from`-kind doc as missing coverage
  // forever, since nothing can ever satisfy it — see docs/adr/0002. Caught loudly at
  // decode time instead.
  it('returns a Failure when a rule references a kind id not declared in `kinds`', () => {
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                {
                  description: 'A product feature doc.',
                  id: 'feature',
                  select: { by: 'path', glob: 'product/features/**' },
                },
              ],
              rules: [{ from: 'feature', to: 'decisionn' }],
            },
          },
        }),
      ),
    ).toBeTruthy()
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
              ],
              rules: [{ from: 'featur', to: 'decision' }],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  // Not just isFailure=true: the message must actually name the typo'd id
  // and where it is, matching what `formatConfigError` hands the user —
  // an empty or generic message would technically still be "a Failure" but
  // wouldn't be actionable.
  it('names the undeclared kind id and its position in the Failure message', () => {
    const result = decodeConfig({
      checks: {
        coverage: {
          kinds: [
            {
              description: 'A product feature doc.',
              id: 'feature',
              select: { by: 'path', glob: 'product/features/**' },
            },
          ],
          rules: [{ from: 'feature', to: 'decisionn' }],
        },
      },
    })
    if (!Result.isFailure(result)) {
      throw new Error('expected a Failure')
    }
    expect(result.failure.message).toContain('references undeclared kind "decisionn"')
    expect(result.failure.message).toContain('rules')
    expect(result.failure.message).toContain('to')
  })

  // Issue #28's third v1 check, doc→code reference resolution: a rule's
  // `to` can name an external (non-doc-kind) target instead of a declared
  // kind id — `{ external: 'path' }` means "a real file on disk," not "a
  // doc of some kind." Round-trips like every other rule shape.
  it('decodes a rule’s `to: { external: "path" }` — doc→code reference resolution, not a doc-kind target', () => {
    const raw = {
      checks: {
        coverage: {
          kinds: [{ description: 'A specification doc.', id: 'spec', select: { by: 'path', glob: 'docs/spec/**' } }],
          rules: [{ from: 'spec', to: { external: 'path' } }],
        },
      },
    }
    expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
  })

  // The undeclared-kind-id cross-field check only applies when `to` is a
  // plain kind-id string — an `{ external: 'path' }` target names no kind
  // at all, so it must never be rejected as "undeclared."
  it('never rejects `to: { external: "path" }` as an undeclared kind id', () => {
    const result = decodeConfig({
      checks: {
        coverage: {
          kinds: [{ description: 'A specification doc.', id: 'spec', select: { by: 'path', glob: 'docs/spec/**' } }],
          rules: [{ from: 'spec', to: { external: 'path' } }],
        },
      },
    })
    expect(Result.isSuccess(result)).toBeTruthy()
  })

  it('returns a Failure when a rule’s `to` object names an unrecognised external kind', () => {
    expect(
      Result.isFailure(
        decodeConfig({
          checks: {
            coverage: {
              kinds: [
                { description: 'A specification doc.', id: 'spec', select: { by: 'path', glob: 'docs/spec/**' } },
              ],
              rules: [{ from: 'spec', to: { external: 'url' } }],
            },
          },
        }),
      ),
    ).toBeTruthy()
  })

  it('accepts a rule whose `from`/`to` both match declared kind ids', () => {
    const raw = {
      checks: {
        coverage: {
          kinds: [
            {
              description: 'A product feature doc.',
              id: 'feature',
              select: { by: 'path', glob: 'product/features/**' },
            },
            { description: 'A decision record doc.', id: 'decision', select: { by: 'path', glob: 'docs/adr/**' } },
          ],
          rules: [{ from: 'feature', to: 'decision' }],
        },
      },
    }
    expect(Result.isSuccess(decodeConfig(raw))).toBeTruthy()
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

  // Issue #108: source-tree coverage — a SEPARATE key from `checks.coverage`,
  // deliberately (see Config.ts's own comment on `DocCoverageInputSchema` for
  // why it isn't folded into `coverage`'s `kinds`/`rules` shape).
  describe('checks.docCoverage (issue #108)', () => {
    it('decodes `checks.docCoverage` — presence itself is the opt-in, no separate `enabled` field', () => {
      const raw = {
        checks: {
          docCoverage: {
            coveredBy: [{ glob: 'docs/architecture.md', kind: 'architecture' }],
            sources: ['src/*/index.ts'],
          },
        },
      }
      expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
    })

    it('decodes `checks.docCoverage.exempt` when present', () => {
      const raw = {
        checks: {
          docCoverage: {
            coveredBy: [{ glob: 'docs/architecture.md', kind: 'architecture' }],
            exempt: ['src/testSupport/**'],
            sources: ['src/*/index.ts'],
          },
        },
      }
      expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
    })

    it('decodes multiple `coveredBy` groups', () => {
      const raw = {
        checks: {
          docCoverage: {
            coveredBy: [
              { glob: 'docs/architecture.md', kind: 'architecture' },
              { glob: 'docs/adr/*.md', kind: 'adr' },
            ],
            sources: ['src/*/index.ts'],
          },
        },
      }
      expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
    })

    // Same escape hatch as `checks.coverage: false` above, for the same
    // reason: a descendant config needs a way to re-disable an inherited
    // `extends` preset's docCoverage.
    it('decodes `checks.docCoverage: false` — an explicit re-disable, distinct from omitting the key entirely', () => {
      const raw = { checks: { docCoverage: false as const } }
      expect(Result.getOrThrow(decodeConfig(raw))).toEqual(raw)
    })

    it('returns a Failure on an unknown key inside `checks.docCoverage` or a coveredBy group', () => {
      expect(Result.isFailure(decodeConfig({ checks: { docCoverage: { coveredBy: [], sourcez: [] } } }))).toBeTruthy()
      expect(
        Result.isFailure(
          decodeConfig({
            checks: { docCoverage: { coveredBy: [{ globb: 'x', kind: 'y' }], sources: [] } },
          }),
        ),
      ).toBeTruthy()
    })

    it('returns a Failure when `sources` or `coveredBy` is missing entirely', () => {
      expect(Result.isFailure(decodeConfig({ checks: { docCoverage: { coveredBy: [] } } }))).toBeTruthy()
      expect(Result.isFailure(decodeConfig({ checks: { docCoverage: { sources: [] } } }))).toBeTruthy()
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

describe('onlyGitTracked (issue #48)', () => {
  it('accepts a boolean', () => {
    expect(Result.getOrThrow(decodeConfig({ onlyGitTracked: true })).onlyGitTracked).toBeTruthy()
    expect(Result.getOrThrow(decodeConfig({ onlyGitTracked: false })).onlyGitTracked).toBeFalsy()
  })

  it('rejects a non-boolean instead of silently coercing it', () => {
    expect(Result.isFailure(decodeConfig({ onlyGitTracked: 'true' }))).toBeTruthy()
  })

  it('is absent (not defaulted) when not specified — resolution, not decoding, applies the default', () => {
    expect(Result.getOrThrow(decodeConfig({})).onlyGitTracked).toBeUndefined()
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

// Adversarial-review finding (issue #28's PR): the `typeof to === 'string'`
// discriminant was hand-re-derived independently at 6 call sites across
// Config.ts/Coverage.ts/CheckCoverage.ts — the same "drift silently,
// nobody notices" shape `isSafelyWithinBase` was already extracted to fix
// for symlink containment, just for this discriminant instead. A future
// second `external` variant (Config.ts's own comment already anticipates
// one) needs every one of those sites updated by hand; centralizing the
// check here means they all stay correct by construction.
describe('isKindTarget()', () => {
  it('is true for a plain kind-id string', () => {
    expect(isKindTarget('decision')).toBeTruthy()
  })

  it('is false for an external-path target', () => {
    expect(isKindTarget({ external: 'path' })).toBeFalsy()
  })
})

describe('the built-in defaults', () => {
  it('matches the documented defaults', () => {
    expect(DEFAULT_CONFIG).toEqual({
      checks: { coverage: null, docCoverage: null, links: true, summaries: true },
      ignore: ['**/node_modules/**'],
      locale: 'en',
      naming: { dirSummary: '_SUMMARY.md', fileSummarySuffix: '.summary.md' },
      onlyGitTracked: false,
      requireDirSummaries: true,
      roots: ['docs'],
      stampCommand: 'npx cairn check --summaries-only --stamp',
      thresholdLines: 30,
    })
  })
})
