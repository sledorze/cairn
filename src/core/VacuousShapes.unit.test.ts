// A SYSTEMATIC regression test, not a scattered one — see the design task
// this closes: three separate review rounds this session independently hit
// the SAME underlying defect class (an expressive matcher silently
// degrading to "always true" or "always false" with no signal), found and
// fixed one instance at a time:
//   1. `**` in a `KindSelector.by: 'path'` glob CAN match zero path
//      segments (docs/design/CONVENTION.md's own "single * (not **)
//      between docs/design/ and the filename matters" callout).
//   2. `scope: { under: '' }` (or `'/'`/`'///'`, anything trimming to
//      empty) collapsed `scopeSatisfied`'s glob to `**//**`, matching every
//      path in the corpus — fixed at decode time (`checkUnderNotEmpty`,
//      ./Config.ts).
//   3. `scope: { under: 'a/typo' }` naming a directory nothing in the
//      corpus actually has — fixed at RUN time, once the real doc corpus
//      is scanned (`CheckCoverage.ts`'s `emptyScopeUnders`), since decode
//      time alone can't see the real corpus.
//
// `fast-check` (or any property-based testing library) is NOT a
// devDependency of this repo (checked: `package.json`'s `devDependencies`
// has no `fast-check` entry) — adding one for this alone would cut against
// this repo's own minimal-dependency discipline (AGENTS.md), so this is the
// deliberately smaller, explicit alternative: one TABLE per vacuity-prone
// shape, each row asserting the actual, current safeguard (reject at
// decode time, warn at run time once the corpus is known, or — for the one
// shape that structurally can't be safely rejected — a characterization
// test proving the behavior is real and understood, not silently ignored).
import { Result } from 'effect'
import { describe, expect, it } from 'vitest'

import { decodeConfig } from './Config.ts'
import { matchesGlob } from './glob.ts'

describe('vacuity-prone matcher shapes — a systematic table, not one-off fixes', () => {
  // Shape 1: `**` matching ZERO path segments. Deliberately NOT
  // schema-rejected — unlike the other three shapes below, this one can't
  // be: `**` legitimately matching zero segments is a USED, INTENDED
  // feature elsewhere in this exact codebase (`ignore: ['**/node_modules/**']`
  // needs `**` to also match a top-level `node_modules`, and `**/CHANGELOG.md`
  // needs to match a root-level `CHANGELOG.md`, not just a nested one — see
  // ./glob.unit.test.ts's own "matches a `**/name` suffix at any depth"
  // test). Rejecting "a glob whose `**` could match zero segments" would
  // make those legitimate, already-shipped uses invalid too — there is no
  // schema-level rule that separates "author meant zero-or-more" from
  // "author meant one-or-more" without reading the AUTHOR's intent, which a
  // decoder can't do. This is a genuinely different case from the other
  // three: a documented, deliberate NON-fix (matches CONVENTION.md's own
  // guidance: name the pattern precisely, e.g. a single `*` instead of `**`,
  // when zero-segment matching isn't wanted), not an oversight. This test
  // exists to keep that non-fix HONEST — confirming the vacuity is real,
  // not hypothetical, so it can't silently stop being true without a test
  // noticing.
  it('`**` in a glob DOES match zero path segments — the real, still-open vacuity, confirmed rather than assumed', () => {
    // The concrete CONVENTION.md scenario: a `**`-joined kind glob would
    // also match the package INDEX itself, not just a package's own child
    // docs — the exact reason CONVENTION.md's real kinds use a single `*`
    // (`**/docs/design/*/_SUMMARY.md`) instead of `**` there.
    expect(matchesGlob('docs/design/_SUMMARY.md', '**/docs/design/**/_SUMMARY.md')).toBeTruthy()
    expect(matchesGlob('docs/design/pkg/_SUMMARY.md', '**/docs/design/*/_SUMMARY.md')).toBeTruthy()
    // The actual fix this repo applies isn't a schema rule — it's picking
    // the RIGHT glob (`*`, not `**`) for a case that must NOT zero-match:
    expect(matchesGlob('docs/design/_SUMMARY.md', '**/docs/design/*/_SUMMARY.md')).toBeFalsy()
  })

  // Shape 2: an empty (or slashes-only) `scope.under` — rejected at DECODE
  // time (`checkUnderNotEmpty`, ./Config.ts), the case that CAN be
  // mechanically distinguished from a legitimate value: there's no reading
  // of `under: ''` that isn't a mistake, unlike a `**` glob's genuine
  // ambiguity above.
  // Deliberately NOT including a whitespace-only `under` (e.g. `'  '`) in
  // this table: `checkUnderNotEmpty` (./Config.ts) only trims LEADING/
  // TRAILING SLASHES, not arbitrary whitespace, so `under: '  '` decodes
  // successfully today — checked here, not assumed, and found to fall into
  // a DIFFERENT bucket than this table: it's not silently vacuous (it
  // would build a `**/  /**` glob no real path segment equals, so it fails
  // LOUD, the same "permanently unsatisfiable" shape a typo'd `under`
  // already produces — caught by `emptyScopeUnders`'s own RUN-time warning,
  // not this decode-time table). Recorded here rather than silently
  // widening the table to a case this repo's own existing precedent
  // doesn't treat as decode-time-rejectable.
  it.each(['', '/', '///'])('rejects `scope: { under: %j } }` at decode time — no legitimate use for it', (under) => {
    const result = decodeConfig({
      checks: {
        coverage: {
          kinds: [{ description: 'A roadmap doc.', id: 'roadmap', select: { by: 'path', glob: 'docs/design/**' } }],
          rules: [{ from: 'roadmap', scope: { under }, to: 'roadmap' }],
        },
      },
    })
    expect(Result.isFailure(result)).toBeTruthy()
  })

  // Shape 3: an empty `to` array (`to: []`) — the OR-alternation shape's
  // own vacuity trap, rejected at decode time for the same reason as Shape
  // 2: zero alternatives can never be satisfied, no legitimate reading of
  // it exists.
  it('rejects `to: []` (empty array) at decode time — a rule with zero alternatives can never be satisfied', () => {
    const result = decodeConfig({
      checks: {
        coverage: {
          kinds: [{ description: 'A roadmap doc.', id: 'roadmap', select: { by: 'path', glob: 'docs/design/**' } }],
          rules: [{ from: 'roadmap', to: [] }],
        },
      },
    })
    expect(Result.isFailure(result)).toBeTruthy()
  })

  // Shape 4 — new in this task: `atLeast: { n: 0, of: [...] }`. `n: 0`
  // would make the rule vacuously SATISFIED by nothing, the mirror image of
  // Shapes 2/3 above (which are vacuously satisfied by EVERYTHING, or
  // permanently unsatisfiable) — same failure CLASS ("an expressive
  // matcher silently degrades to always-true or always-false"), a
  // different concrete shape. Rejected at decode time for the same reason
  // Shapes 2/3 are: no legitimate config ever means `n: 0`.
  it.each([0, -1, -5])(
    'rejects `atLeast: { n: %j, of } }` at decode time — would be vacuously satisfied by nothing',
    (n) => {
      const result = decodeConfig({
        checks: {
          coverage: {
            kinds: [
              { description: 'A roadmap doc.', id: 'roadmap', select: { by: 'path', glob: 'docs/design/**' } },
              { description: 'A spike doc.', id: 'spikes', select: { by: 'path', glob: 'docs/spikes/**' } },
            ],
            rules: [{ from: 'roadmap', to: { atLeast: { n, of: ['spikes'] } } }],
          },
        },
      })
      expect(Result.isFailure(result)).toBeTruthy()
    },
  )

  it('rejects `atLeast: { of: [] } }` (empty `of`) at decode time — the same trap as an empty `to` array', () => {
    const result = decodeConfig({
      checks: {
        coverage: {
          kinds: [{ description: 'A roadmap doc.', id: 'roadmap', select: { by: 'path', glob: 'docs/design/**' } }],
          rules: [{ from: 'roadmap', to: { atLeast: { n: 1, of: [] } } }],
        },
      },
    })
    expect(Result.isFailure(result)).toBeTruthy()
  })

  // Shape 5 — found by this task's OWN adversarial self-review (Part D),
  // not hand-crafted for this table after the fact: a duplicate target in
  // `atLeast.of` lets ONE real satisfying link count toward `n` TWICE,
  // silently requiring fewer DISTINCT links than `n` implies. Confirmed
  // real before the fix (`checkAtLeastSane`, ./Config.ts): a direct
  // `resolveRuleEdges` call with `atLeast: { n: 2, of: ['spikes', 'spikes']
  // }` against a doc with exactly ONE link to a `spikes`-kind doc came back
  // `satisfied: true` — the exact vacuity class every other row in this
  // table exists to catch, found INSIDE the very feature meant to close it.
  it('rejects `atLeast.of` containing a duplicate target at decode time — one link must not count twice toward `n`', () => {
    const result = decodeConfig({
      checks: {
        coverage: {
          kinds: [
            { description: 'A roadmap doc.', id: 'roadmap', select: { by: 'path', glob: 'docs/design/**' } },
            { description: 'A spike doc.', id: 'spikes', select: { by: 'path', glob: 'docs/spikes/**' } },
          ],
          rules: [{ from: 'roadmap', to: { atLeast: { n: 2, of: ['spikes', 'spikes'] } } }],
        },
      },
    })
    expect(Result.isFailure(result)).toBeTruthy()
  })
})
