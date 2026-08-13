import { describe, expect, it } from 'vitest'

import { extractBackboneStepTiers, findWalkingSkeletonViolations } from './StoryMapTiers.ts'

const DOC = `# Story map

## Backbone

\`A\` -> \`B\`

## Cards, by backbone step

### 1. First step

- _As a person, I want X_ (Must)
- _As a person, I want Y_ (Should)

### 2. Second step

- _As a person, I want Z_ (Could)
- _As a person, I want W_ (Could)

## Walking skeleton

Some prose.
`

describe('extractBackboneStepTiers()', () => {
  it('finds every backbone-step heading under "Cards, by backbone step" and counts its tags', () => {
    expect(extractBackboneStepTiers(DOC)).toEqual([
      { could: 0, heading: '1. First step', line: 9, must: 1, should: 1, step: 1 },
      { could: 2, heading: '2. Second step', line: 14, must: 0, should: 0, step: 2 },
    ])
  })

  it('returns [] for a doc with no "Cards, by backbone step" section at all', () => {
    expect(extractBackboneStepTiers('# Just a doc\n\nNo cards section here.\n')).toEqual([])
  })

  it('does not let a card in one step leak its tags into a sibling step', () => {
    // Regression guard for a section-boundary bug: step 2's own (Could)(Could) must never
    // be counted as part of step 1's span.
    const steps = extractBackboneStepTiers(DOC)
    expect(steps[0]?.could).toBe(0)
    expect(steps[1]?.must).toBe(0)
  })

  it('stops a step span at the next heading of equal-or-shallower level, including the trailing Walking skeleton section', () => {
    const docWithTrailingMust = DOC.replace('Some prose.', 'Some prose (Must).')
    const steps = extractBackboneStepTiers(docWithTrailingMust)
    // The trailing "(Must)" lives under "## Walking skeleton", NOT under step 2 — it must
    // not inflate step 2's own must count.
    expect(steps[1]?.must).toBe(0)
  })

  it('counts a step with zero cards below it as zero of everything, not a crash', () => {
    const doc = `# D\n\n## Cards, by backbone step\n\n### 1. Empty step\n`
    expect(extractBackboneStepTiers(doc)).toEqual([
      { could: 0, heading: '1. Empty step', line: 5, must: 0, should: 0, step: 1 },
    ])
  })

  it("counts a tag that carries explanatory prose in the SAME parenthetical, matching this repo's own real convention", () => {
    // Real, pre-existing shape from docs/design/137-typed-relations/story-map.md:
    // `_(Must — directly resolves #130's "a relation needs no link.")_` — the tier word is
    // the first token after the opening paren, but the paren does not close right after it.
    const doc = `# D\n\n## Cards, by backbone step\n\n### 1. Step\n\n- _Card_ (Must — some rationale, see elsewhere)\n`
    const steps = extractBackboneStepTiers(doc)
    expect(steps[0]?.must).toBe(1)
  })

  it('never counts a `(Must)` that appears inside a FENCED CODE example, only real tags outside the fence', () => {
    // A step whose only ACTUAL card is untagged, but whose text also includes a fenced
    // code block quoting the tag convention itself as a syntax example — exactly the kind
    // of self-documenting example this repo's own docs habitually include (AGENTS.md
    // quotes its own conventions the same way). Before fenced-code masking was added, this
    // step's `(Must)` inside the fence was indistinguishable from a real tag, so a step
    // with ZERO real Must-tagged cards would silently read as compliant.
    const doc =
      '# D\n\n' +
      '## Cards, by backbone step\n\n' +
      '### 1. Step with a code example, no real Must card\n\n' +
      '- _Card, untagged_\n\n' +
      '```\n' +
      'Tag convention: _(Must)_ marks the essential card at each step.\n' +
      '```\n'
    const steps = extractBackboneStepTiers(doc)
    expect(steps[0]?.must).toBe(0)
    expect(findWalkingSkeletonViolations(steps)).toEqual([
      { heading: '1. Step with a code example, no real Must card', line: 5, mustCount: 0, step: 1 },
    ])
  })

  it('correctly bounds the LAST backbone step when no heading follows it at all (real end of file, no trailing section)', () => {
    const doc =
      '# D\n\n' +
      '## Cards, by backbone step\n\n' +
      '### 1. First step\n\n' +
      '- _Card_ (Should)\n\n' +
      '### 2. Last step, nothing follows it\n\n' +
      '- _Card A_ (Must)\n' +
      '- _Card B_ (Could)\n'
    const steps = extractBackboneStepTiers(doc)
    expect(steps).toEqual([
      { could: 0, heading: '1. First step', line: 5, must: 0, should: 1, step: 1 },
      { could: 1, heading: '2. Last step, nothing follows it', line: 9, must: 1, should: 0, step: 2 },
    ])
  })

  it('requires exact-case `(Must)`/`(Should)`/`(Could)` — a lowercase `(must)` does not count', () => {
    // Deliberate decision, not an accident: every real tag in this repo's own story-maps
    // is capitalized (`(Must)`, `(Should)`, `(Could)`) — see docs/design/*/story-map.md.
    // Matching case-insensitively would risk counting a stray lowercase "(must)" used as
    // plain English inside prose (e.g. "the doc (must not skip this)") as a real MoSCoW
    // tag it never was; requiring exact case keeps the tag vocabulary unambiguous.
    const doc = '# D\n\n## Cards, by backbone step\n\n### 1. Step\n\n- _Card_ (must)\n'
    const steps = extractBackboneStepTiers(doc)
    expect(steps[0]?.must).toBe(0)
  })
})

describe('findWalkingSkeletonViolations()', () => {
  it('flags a step with zero (Must)-tagged cards', () => {
    const steps = [{ could: 0, heading: '1. Step', line: 1, must: 0, should: 1, step: 1 }]
    expect(findWalkingSkeletonViolations(steps)).toEqual([{ heading: '1. Step', line: 1, mustCount: 0, step: 1 }])
  })

  it('flags a step with more than one (Must)-tagged card — no single thinnest slice', () => {
    const steps = [{ could: 0, heading: '1. Step', line: 1, must: 2, should: 0, step: 1 }]
    expect(findWalkingSkeletonViolations(steps)).toEqual([{ heading: '1. Step', line: 1, mustCount: 2, step: 1 }])
  })

  it('does not flag a step with exactly one (Must)-tagged card', () => {
    const steps = [{ could: 1, heading: '1. Step', line: 1, must: 1, should: 1, step: 1 }]
    expect(findWalkingSkeletonViolations(steps)).toEqual([])
  })

  it('returns [] for no steps at all', () => {
    expect(findWalkingSkeletonViolations([])).toEqual([])
  })
})
