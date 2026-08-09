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
// it. Confirmed live: this repo's own already-scaffolded AGENTS.md and
// .claude/skills/cairn/SKILL.md were still telling readers to run the bare
// default the moment `stampCommand` diverged from it.
//
// A second adversarial pass on THIS fix found the first version of this test
// too weak: `.toContain('stampCommand')` passes for a wording that mentions
// the word in passing while still literally instructing "Run `npx cairn
// check --summaries-only --stamp`." right next to it — the exact bug,
// un-fixed, with a decoy nearby. `mentionsStampCommandAsTheRunInstruction`
// below requires the imperative "run"/"Run" to be directly followed by
// something that reads `stampCommand`/"configured" rather than a bare
// `npx cairn check...` literal, which the decoy wording fails.
const mentionsStampCommandAsTheRunInstruction = (text: string): boolean =>
  /\brun\b[^.]{0,40}(stampCommand|configured)/i.test(text) &&
  !/\brun\b\s*`npx cairn check --summaries-only --stamp`/i.test(text)

describe('scaffolded stamp-command guidance references stampCommand, not a bare literal', () => {
  it('CONVENTION_BODY\'s actionable "Workflow when you edit docs" step 3 mentions stampCommand', () => {
    const step3 = CONVENTION_BODY.split('## Workflow when you edit docs')[1]?.split('## Commands')[0]
    expect(step3).toBeDefined()
    expect(step3).toContain('stampCommand')
    expect(mentionsStampCommandAsTheRunInstruction(step3 ?? '')).toBeTruthy()
  })

  it('SKILL_BODY\'s "Stamp mechanically" step mentions stampCommand', () => {
    const stampStep = SKILL_BODY.split('**Stamp mechanically.**')[1]
    expect(stampStep).toBeDefined()
    expect(stampStep).toContain('stampCommand')
    expect(mentionsStampCommandAsTheRunInstruction(`run ${stampStep}`)).toBeTruthy()
  })

  it('rejects the decoy wording an adversarial review found: mentions stampCommand nearby while still literally instructing the bare default', () => {
    const decoy = 'Run `npx cairn check --summaries-only --stamp`. (Note: stampCommand also exists in .cairnrc.json.)'
    expect(decoy).toContain('stampCommand')
    expect(mentionsStampCommandAsTheRunInstruction(decoy)).toBeFalsy()
  })
})
