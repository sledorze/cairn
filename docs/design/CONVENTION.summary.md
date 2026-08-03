# Design-package convention — summary

Design packages (`docs/design/<slug>/`) stay hand-authored prose — no generated template —
but their required shape (`_SUMMARY.md`, `problem-space.md`, `solution-space.md`,
`spikes.md`, `story-map.md`, `roadmap.md`, `implementation-details.md`, `knowledge.md`) is
structurally enforced by `checks.coverage`. `problem-space.md` means the real need/market/
context this work responds to, not just its technical symptom.

**Capturability, stress-tested three times, each finding something real:**

1. A shared wildcard kind is capturable — a hollow package cross-linking a real sibling's
   docs passed cleanly, zero warnings.
2. Per-package hand-scoping closes that but reopens the ORIGINAL gap — an unconfigured new
   package goes silently uncaught, and config grows without bound per package.
3. **The real fix:** `scope: "sibling"`, a genuinely new `CoverageRule` field
   (`core/Config.ts`, `core/structure/Coverage.ts`) — satisfied only by a `to`-kind doc in
   the SAME directory as the `from` doc. One small, generic, wildcard-glob config block now
   closes BOTH gaps at once, for every package present and future, with zero per-package
   config ever again — verified by re-running both attacks against the final config.

The earlier onboarding-guard script became provably dead code once the wildcard kind made
its own check structurally unfailable — removed rather than left as confusing cruft.

**Real guidance, not just labels:** `rule.name` (e.g. `grounded_by`) only ever fed a bare
disambiguating label into the report — a reader had no way to know what it meant. A new
`description` field renders actual fix guidance under the missing-coverage message, and is
now MANDATORY whenever `name` is set (decode-time check) — refuted the "mandatory
everywhere" version first: an unnamed rule's report line is already self-explanatory, so
forcing one there would be filler. Adding `scope`/`description` also caught the rule-dedup
key's own recurring omission bug (4th occurrence) on first write, via its own standing
warning comment.

**Re-examined and corrected:** the 7 "design-package requires X" rules were first left
unnamed on the "self-explanatory" theory — didn't survive contact with "why DOES a design
package need its own spikes.md." All 13 of this repo's own rules ended up named with real
descriptions; the unnamed escape hatch remains available but isn't the default to reach for.
Same principle extended to `KindDef`: a bare kind id has no auto-generated sentence around
it at all (unlike a rule's report line), so `description` there is unconditionally required,
not conditional on `name` — every one of this repo's 8 kinds now carries one.

**Materialized as a real, shipped skill**: `cairn init --agent claude` scaffolds
`.claude/skills/cairn-design-package/SKILL.md`, teaching this whole discipline to every
future cairn consumer — dogfooded and locked in with a real integration test.

**Dev-issue linking:** real, but un-enforced (`checks.coverage` can't classify an external
URL as a kind today — would need a new `CoverageTarget` variant). **Product-issue/vision
layer:** raised, not modeled — no real interview/customer-feedback content exists in this
repo to ground it in honestly.
