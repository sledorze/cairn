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
mention; real but unenforced, since `checks.coverage`'s `CoverageTarget` has no URL variant.
A "product issue" layer (interview/user-feedback signal upstream of a dev issue) is
explicitly not modeled — no real product-feedback content in this repo to ground it in.

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
enforces link existence only, never content). Schema expressiveness does NOT hold either:
`KindSelector`/`CoverageTarget`/`CoverageRequirement.by`/`scope` are each single- or
dual-variant unions, unable to express a URL target, a sub-tree scope, N-of-M alternation,
or a freshness rule. Six measurable checks (product-term lexicon ratio, persona audit,
evidence-source classifier, schema variant census, self-reported-gap closure tracking,
hedge-language census) track both gaps as numbers over time. Reusable, business-agnostic
prompts for running this kind of review on any `checks.coverage` structure are in
[`review-prompts.md`](./review-prompts.md).

Full historical narrative (what was tried, what failed, what was found) is in
`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md`'s amendments.
