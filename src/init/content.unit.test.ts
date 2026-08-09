import { describe, expect, it } from 'vitest'

import { CONVENTION_BODY, SKILL_BODY } from './content.ts'

// Regression test for a real drift found by an adversarial /goal review of PR #153
// (dogfooding `stampCommand` for this repo's own format-before-stamp fix):
// these two scaffolded bodies each have an ACTIONABLE step telling the
// reader/agent to literally run a stamp command. Before this fix, both
// hardcoded the bare default (`npx cairn check --summaries-only --stamp`)
// with no reference to `stampCommand` at all — so the moment ANY cairn
// consumer customizes `stampCommand` (exactly what this repo's own
// .cairnrc.json now does), their scaffolded onboarding docs silently start
// telling readers to run the wrong command, forever, with nothing to catch
// it.
//
// Two more adversarial passes on this fix each broke the previous version of
// this test:
// - Pass 2 found a character-window matcher (`stampCommand` within 40 chars
//   of "run") satisfiable by filler text co-occurring with the bare command
//   in the SAME sentence.
// - Pass 3's fix (scope the check to the sentence containing "run", split on
//   the first period) had a bug of its own: `.cairnrc.json`'s OWN leading dot
//   was misread as a sentence-ending period, truncating the "sentence" before
//   it ever reached the bare command — passing by accident, not by actually
//   being safe. Natural-language sentence-boundary detection via regex is
//   inherently fragile (headings, code spans, abbreviations, and filenames
//   all contain periods that aren't sentence boundaries).
//
// Final, robust design: don't try to parse sentence boundaries at all. The
// actionable step's text must reference `stampCommand`, and must NOT contain
// the bare literal command as an exact substring anywhere — full stop, no
// windowing, no sentence-splitting. This can't be fooled by co-occurrence or
// punctuation, because it isn't looking at proximity or grammar at all.
// A fourth adversarial pass found this exact-substring check itself gameable
// by cosmetic mangling of the bare command that a human still reads as "the
// same command" — extra/tab whitespace, a capitalized sentence-initial
// "Npx", or a code span split across two backticks. Normalizing whitespace
// runs and lowercasing before comparing closes the whitespace/case variants;
// splitting the code span is a much rarer, deliberate-looking edit this test
// doesn't chase further (diminishing returns past this point).
const BARE_STAMP_COMMAND = 'npx cairn check --summaries-only --stamp'
const normalize = (text: string): string => text.toLowerCase().replaceAll(/\s+/g, ' ')

const referencesStampCommandWithoutTheBareLiteral = (text: string): boolean =>
  text.includes('stampCommand') && !normalize(text).includes(normalize(BARE_STAMP_COMMAND))

describe('scaffolded stamp-command guidance references stampCommand, not a bare literal', () => {
  it('CONVENTION_BODY\'s actionable "Workflow when you edit docs" step 3 references stampCommand, never the bare command', () => {
    const step3 = CONVENTION_BODY.split('## Workflow when you edit docs')[1]?.split('## Commands')[0]
    expect(step3).toBeDefined()
    expect(referencesStampCommandWithoutTheBareLiteral(step3 ?? '')).toBeTruthy()
  })

  it('SKILL_BODY\'s "Stamp mechanically" step references stampCommand, never the bare command', () => {
    const stampStep = SKILL_BODY.split('**Stamp mechanically.**')[1]?.split('**Never hand-edit')[0]
    expect(stampStep).toBeDefined()
    expect(referencesStampCommandWithoutTheBareLiteral(stampStep ?? '')).toBeTruthy()
  })

  // Every decoy wording constructed across all three adversarial passes —
  // each satisfied an earlier, weaker version of this check while still
  // being the exact bug (the bare command appears verbatim as the thing to
  // run). All must be rejected by the final design.
  it.each([
    'Run `npx cairn check --summaries-only --stamp`. (Note: stampCommand also exists in .cairnrc.json.)',
    'Run this command (stampCommand may differ) `npx cairn check --summaries-only --stamp`.',
    'Run the stamp step; note stampCommand exists too, then execute `npx cairn check --summaries-only --stamp` now.',
    'You should run stampCommand ideally, but for now just do: `npx cairn check --summaries-only --stamp`',
    // Pass 3's specific bug: a real production sentence, with `.cairnrc.json`'s
    // dot able to fool a period-based sentence-boundary split.
    "Run this repo's configured stamp command (`stampCommand` in `.cairnrc.json`, " +
      'defaulting to `npx cairn check --summaries-only --stamp` if unset).',
    // Pass 4: whitespace/case cosmetic mangling of the bare literal that a
    // human still reads as the same command.
    'stampCommand aside, run `npx cairn check  --summaries-only --stamp` (double space).',
    'stampCommand aside, run `npx cairn check\t--summaries-only --stamp` (tab).',
    'stampCommand aside, Npx Cairn Check --summaries-only --stamp is what you run.',
  ])('rejects decoy wording that mentions stampCommand while still containing the bare literal: %s', (decoy) => {
    expect(decoy).toContain('stampCommand')
    expect(referencesStampCommandWithoutTheBareLiteral(decoy)).toBeFalsy()
  })

  it('accepts wording that references stampCommand and never spells out the bare literal verbatim', () => {
    const good = "Run this repo's configured stamp command (`stampCommand` in `.cairnrc.json`)."
    expect(referencesStampCommandWithoutTheBareLiteral(good)).toBeTruthy()
  })
})
