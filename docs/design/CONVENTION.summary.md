# Design-package convention — summary

Design packages (`docs/design/<slug>/`) stay hand-authored prose — no
generated template — but their required shape (`_SUMMARY.md`,
`problem-space.md`, `solution-space.md`, `spikes.md`, `story-map.md`,
`roadmap.md`, `implementation-details.md`, `knowledge.md`) is
structurally enforced by cairn's EXISTING `checks.coverage` kinds/
rules mechanism, not a new config primitive.

**Capturability, found and closed for real.** A shared, wildcard kind
(matching ANY package's `spikes.md`) let a throwaway, fully hollow
package pass `checks.coverage` with zero warnings by cross-linking a
real sibling's docs — stress-tested concretely, not assumed. Fixed by
scoping every kind id/glob to the EXACT package path (`101-` prefix,
no `*`). Re-verified: the same fake-package attack now fails to match
any kind at all.

**That fix has its own honest cost, also stress-tested:** a genuinely
new, incomplete package nobody wires into `.cairnrc.json` gets ZERO
structural checking — invisible, not flagged. Closed with a real,
falsified guard script (`scripts/check-design-package-onboarding.ts`,
wired into lefthook + CI) that fails loudly if a real
`docs/design/*/_SUMMARY.md` matches no configured kind.

**A vocabulary for rule names, checked against real content, not
picked for sound.** `grounded_by` was quietly standing in for three
different real relationships — corrected by re-reading each edge's
actual sentence: `grounded_by` (an argument supported by evidence),
`builds_on` (an implementation using a validated approach as its
foundation), `sourced_from` (content restated from elsewhere). A
larger reference vocabulary (requirements-traceability, Toulmin
argumentation theory, evidence/lineage relations — ~30 terms) is
recorded for future rules.

**Materialized as a real, shipped skill**, not just repo-local docs:
`cairn init --agent claude` now scaffolds a second skill file
(`.claude/skills/cairn-design-package/SKILL.md`, `DESIGN_PACKAGE_SKILL_BODY`
in `src/init/content.ts`) teaching this whole discipline — the seven
docs, scoped kinds, precise verb naming, and self-stress-testing —
to every future cairn consumer, not just this repo.

**Dev-issue linking:** every doc carries one real
`[issue #101](github.com/.../101)` link — real, but un-enforced
(`checks.coverage` can't classify an external URL as a kind today).
**Product-issue/vision layer:** raised, not modeled — no real
interview/customer-feedback content exists in this repo to ground it
in; proposed as its own future design package, filed as a real issue
first.
