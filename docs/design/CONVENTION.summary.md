# Design-package convention — summary

Design packages (`docs/design/<slug>/`) stay hand-authored prose — no generated template —
but their required shape (`_SUMMARY.md`, `problem-space.md`, `solution-space.md`,
`spikes.md`, `story-map.md`, `roadmap.md`, `implementation-details.md`, `knowledge.md`) is
structurally enforced by `checks.coverage`. `problem-space.md` means the real need/market/
context this work responds to, not just its technical symptom. `cairn init --agent claude`
scaffolds a skill teaching this shape to any consumer.

**Enforcement**: one generic `checks.coverage` config block (given in full) declares each
required document as a wildcard-glob `kind` and a `{from: design-package, to: <kind>,
scope: "sibling"}` rule per required piece — `scope: "sibling"` restricts a rule to a
`to`-kind doc in the SAME directory as the `from` doc, so the block works for every package
present and future with zero per-package config. The mandatory single `*` (not `**`)
between `docs/design/` and the filename avoids matching the parent `_SUMMARY.md` itself.

**Dev-issue linking**: each package links its GitHub issue from its first substantive
mention; now enforced — `CoverageTarget`'s third variant, `{ external: 'url', pattern }`,
is satisfied by a link whose raw href contains `pattern` (plain substring, not regex/glob).
This repo's own `.cairnrc.json` requires `problem-space` to link something matching
`https://github.com/sledorze/cairn/issues/`. A "product issue" layer (interview/user-feedback
signal upstream of a dev issue) is explicitly not modeled — no real product-feedback content
in this repo to ground it in.

**Rule-naming vocabulary**: `rule.name` disambiguates same-kind-pair rules; pairing it with
a `description` (mandatory whenever `name` is set) gives in-context guidance instead of a
bare label. `description` is unconditionally required on every `KindDef`. A reference
vocabulary (requirements-traceability, Toulmin argumentation, evidence/epistemic, lineage/
process terms) is provided for naming new rules precisely, illustrated by this repo's own
`grounded_by`/`builds_on`/`sourced_from` split.

**Judging this convention** — two claims checked against real content: purpose-clarity
holds for a developer reader (a captured report line is specific and actionable) but does
NOT hold for a product reader (this repo's own `problem-space.md`/`story-map.md`/
`roadmap.md` are dev-shaped content wearing product-sounding filenames; `checks.coverage`
enforces link existence only, never content). Schema expressiveness does NOT fully hold
either: `CoverageRequirement.by` is still single-variant, N-of-M alternation and a freshness
rule are still unexpressible; `scope` now has a SECOND variant, `{ under: 'some/dir' }`
— closing the sibling/corpus-wide granularity gap this doc originally named — but `under`
itself has no validation against the config's real `roots`, a new, narrower, un-closed gap
found while closing the old one; `CoverageTarget` has three variants (a URL target closed
another real gap), but only via a plain substring match, not a real URL grammar. Six
measurable checks (product-term lexicon ratio, persona audit, evidence-source classifier,
schema variant census, self-reported-gap closure tracking, hedge-language census) track both
gaps as numbers over time; the schema variant census and hedge-language census are now
computed for real by `scripts/coverage-metrics.ts` (`pnpm run coverage-metrics`) rather than
hand-counted — current real output (KindSelector.by: 2, CoverageTarget: 3,
CoverageRequirement.by: 1, CoverageRule.scope: 2; hedge phrases total 15) is quoted in full
in this doc. Reusable, business-agnostic prompts for running this kind of review on any
`checks.coverage` structure, plus a validated negative result against `README.md`/
`docs/architecture.md`, are in [`review-prompts.md`](./review-prompts.md).

Full historical narrative (what was tried, what failed, what was found) is in
`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md`'s amendments.
