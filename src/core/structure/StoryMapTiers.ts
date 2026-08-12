// Pure logic for `checks.storyMapTiers` (see ../../program/structure/CheckStoryMapTiers.ts
// for the IO/plugin wiring): a real, live drift was found by auditing this repo's own
// `docs/design/*/story-map.md` files — every one of them carries a heading
// `## Walking skeleton (the line above marks it in each column)` claiming a marked
// walking-skeleton card exists in each backbone-step column, but none of the three files
// actually had exactly one `(Must)`-tagged card per step (two had zero MoSCoW tags
// anywhere at all). The heading's own claim was false in all three files it appears in.
//
// This is deliberately narrow, intra-document structural census — NOT the general typed-
// relations predicate/comparison engine `137-typed-relations/roadmap.md`'s own Release 0
// correctly declined to build (no code-target resolution, no cross-file comparison, no
// evidence/predicate vocabulary). It only ever answers one question, per backbone step,
// within a single doc's own text: how many `(Must)`-tagged cards does this step have?
// The walking-skeleton invariant this repo's own story-map convention describes — "the
// smallest slice that's shippable and actually fixes the reported pain" — is exactly one
// `(Must)` card per backbone step: not zero (nothing named as essential), not more than one
// (no single thinnest slice, just an unprioritized pile).
//
// Reuses `extractHeadingsWithPosition` (../links/Anchors.ts, already used by
// `./DocMetadata.ts` for the same "find headings, know their line/level" need) rather than
// re-deriving a second heading scanner — this file's only new logic is: find the
// `## Cards, by backbone step` section, find its `### N. ...` children, and regex-count
// `(Must|Should|Could)` tags within each child's own text span.

import { extractHeadingsWithPosition } from '../links/Anchors.ts'
import { maskFencedCode } from '../links/markdownFences.ts'

const CARDS_SECTION_HEADING = 'Cards, by backbone step'
// A backbone-step heading's text always starts "N. <title>" (e.g. "1. Cite implementation
// from a doc") in every real story-map.md this repo has — see the 3 files under
// docs/design/*/story-map.md. The leading digit is the step's own declared order; kept as
// a `step` field on each result (rather than re-deriving it from array position) so a
// mis-numbered or reordered heading is visible in the report as a real fact about the doc,
// not silently renumbered by this function.
const BACKBONE_STEP_RE = /^(\d+)\.\s*(.*)$/
// Matches `(Must)` and also `(Must — ...)`/`(Must, ...)` — this repo's own pre-existing
// tags (`137-typed-relations/story-map.md`, e.g. `_(Must — directly resolves #130's "a
// relation needs no link.")_`) already put explanatory prose inside the SAME parenthetical
// as the tag, with the tier word always the very first token right after the opening
// paren. Requiring a bare `(Must)` with nothing else inside would silently fail to count
// those real, pre-existing tags — a word-boundary match on the leading token is what
// actually matches this repo's real convention, not just its simplest example.
const TIER_TAG_RE = /\((Must|Should|Could)\b/g

export interface BackboneStepTierCounts {
  readonly could: number
  /** The step heading's own text, e.g. "1. Cite implementation from a doc" — carried
   * through for report clarity ("step 4: 0 Must-tagged cards"), not just the bare number. */
  readonly heading: string
  /** 1-indexed line the step heading is on (`PositionedHeading.line`) — lets a report point
   * a reader at the exact spot, matching every other line-aware check in this repo. */
  readonly line: number
  readonly must: number
  readonly should: number
  readonly step: number
}

/** Every `### N. ...` backbone-step heading directly under a doc's `## Cards, by backbone
 * step` section, with a census of how many `(Must)`/`(Should)`/`(Could)` tags appear
 * anywhere in that step's own text span (from its heading to the next heading at the same
 * level-or-shallower). A doc with no `Cards, by backbone step` section at all (not this
 * convention's shape) returns `[]` — nothing to census, not an error; the plugin wiring
 * decides separately whether a matched-but-shapeless doc is itself worth a warning. */
export const extractBackboneStepTiers = (content: string): readonly BackboneStepTierCounts[] => {
  const headings = extractHeadingsWithPosition(content)
  // Masked, not raw, content backs the tag scan below — a fenced code block quoting
  // `(Must)` as a syntax example (this repo's own docs constantly do exactly this kind of
  // self-quoting, AGENTS.md included) must never be counted as a real tag. `maskFencedCode`
  // keeps line count/newlines intact (see its own header), so the line numbers
  // `extractHeadingsWithPosition` already computed from the UNMASKED `content` (it masks
  // internally before scanning, same as this file now does explicitly) still line up
  // exactly with `lines` below.
  const lines = maskFencedCode(content).split('\n')

  const cardsSection = headings.find((h) => h.text.trim() === CARDS_SECTION_HEADING)
  if (cardsSection === undefined) {
    return []
  }

  const stepHeadings = headings.filter(
    (h) => h.line > cardsSection.line && h.level === cardsSection.level + 1 && BACKBONE_STEP_RE.test(h.text.trim()),
  )

  return stepHeadings.map((h) => {
    const match = BACKBONE_STEP_RE.exec(h.text.trim())
    const stepText = match?.[1]
    // `Number.parseInt`, not `Number(...)`, is used deliberately here (oxlint's own
    // `unicorn/prefer-number-coercion` would rather see `Math.trunc(Number(stepText))`) —
    // this repo's write-time guard (`no-raw-coercion`, `.claude/settings.json`'s falsestart
    // preset) blocks a raw `Number(...)` coercion outright, so `Number.parseInt` is the one
    // form both tools accept; `stepText` is already `\d+`-matched by `BACKBONE_STEP_RE`, so
    // no radix ambiguity is possible either way.
    // oxlint-disable-next-line unicorn/prefer-number-coercion
    const step = stepText === undefined ? 0 : Number.parseInt(stepText, 10)
    // The next heading at this step's own level or shallower ends its span — this
    // uniformly covers both "the next backbone step" (same level) and "the end of the
    // whole Cards section" (a shallower heading, or none: end of file), since every real
    // step heading shares `cardsSection.level + 1`.
    const nextHeadingLine = headings.find((hh) => hh.line > h.line && hh.level <= h.level)?.line ?? lines.length + 1
    const sectionText = lines.slice(h.line, nextHeadingLine - 1).join('\n')
    const tags = [...sectionText.matchAll(TIER_TAG_RE)].map((m) => m[1])
    return {
      could: tags.filter((t) => t === 'Could').length,
      heading: h.text.trim(),
      line: h.line,
      must: tags.filter((t) => t === 'Must').length,
      should: tags.filter((t) => t === 'Should').length,
      step,
    }
  })
}

export interface WalkingSkeletonViolation {
  readonly heading: string
  readonly line: number
  readonly mustCount: number
  readonly step: number
}

/** The walking-skeleton invariant: every backbone step must have EXACTLY one `(Must)`-
 * tagged card — the thinnest complete slice at that step. Zero means nothing was named
 * essential there; more than one means there's no single thinnest slice, just several
 * cards all claiming the same top priority. */
export const findWalkingSkeletonViolations = (
  steps: readonly BackboneStepTierCounts[],
): readonly WalkingSkeletonViolation[] =>
  steps.filter((s) => s.must !== 1).map((s) => ({ heading: s.heading, line: s.line, mustCount: s.must, step: s.step }))
