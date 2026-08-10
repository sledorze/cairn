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

**Writing a good `description`** (new subsection, a sibling to naming, for library
consumers writing their own rules): state which doc makes the claim and which is its
evidence (direction), and name ONE concrete, relationship-specific way a link could be
technically present but hollow — not a generic "make sure it's good." Don't write a
per-rule content disclaimer either: `CheckCoverage.ts` now prints one shared, automatic
"coverage only confirms links exist" line whenever any shown rule has a `description`, so a
rule's own text should spend its words elsewhere. This repo's own 14 `.cairnrc.json` rule
descriptions (and `DESIGN_PACKAGE_SKILL_BODY`'s scaffolded copy in `src/init/content.ts`,
which `cairn init --agent claude` ships to consumers) were revised against this discipline;
two deliberately different before/afters (the `solution-space` → `spikes` `grounded_by`
rule, a citation-mismatch failure; the `design-package` → `spikes` `requires` rule, a
content-narration failure) are given as worked examples.

**Judging this convention** — two claims checked against real content: purpose-clarity
holds for a developer reader (a captured report line is specific and actionable) but does
NOT hold for a product reader (this repo's own `problem-space.md`/`story-map.md`/
`roadmap.md` are dev-shaped content wearing product-sounding filenames; `checks.coverage`
enforces link existence only, never content). Schema expressiveness does NOT fully hold
either: `CoverageRequirement.by` is still single-variant, but `to` can now be a non-empty
ARRAY of targets (or the equivalent `{ any: [...] }`) satisfied by ANY ONE of them — the
OR/alternation reading of the N-of-M gap — AND `{ atLeast: { n, of } }`, satisfied when at
least `n` of `of`'s targets EACH have their own link, which closes the general N-of-M
cardinality reading too (e.g. "at least 2 of 3"; "all of these" is `n: of.length`, no separate
variant); the freshness gap is now CLOSED too — not inside `checks.coverage`, but as its own
separate, minimal `checks.freshness` check (`{ rules: [{ glob, maxAgeDays }] }`, matched
against real git commit history via `io/Git.ts`'s `lastCommitDate`, never filesystem mtime) —
a genuinely TEMPORAL axis, not the RELATIONAL one every other gap in this section addresses,
so it was deliberately NOT bolted onto `CoverageRule`. Its origin is the same real incident
GitHub issue #101 documents ("found using cairn 0.6.0 in `sledorze/falsestart`" — `--refs`
failing on every edit to a cited file regardless of whether the doc's own claims changed);
`scope` now has a SECOND variant, `{ under:
'some/dir' }` — closing the sibling/corpus-wide granularity gap this doc originally named —
and `under` itself is now validated too, though at `checkCoverage` run time rather than decode
time (`roots` and `checks.coverage` can live in different `extends` layers, so no single-layer
decode sees both at once); a THIRD, adjacent critique (unifying `scope`'s two variants into one
general path-relation primitive) was raised and deliberately NOT built — only two data points,
recorded as noted-but-deferred rather than built or ignored; `CoverageTarget` has three
variants (a URL target closed another real gap), but only via a plain substring match, not a
real URL grammar. Six measurable checks (product-term lexicon ratio, persona audit,
evidence-source classifier, schema variant census, self-reported-gap closure tracking,
hedge-language census) track both gaps as numbers over time; the schema variant census and
hedge-language census are now computed for real by `scripts/coverage-metrics.ts` (`pnpm run
coverage-metrics`) rather than hand-counted — current real output (KindSelector.by: 2,
CoverageTarget: 3, CoverageRequirement.by: 1, CoverageRule.scope: 2; hedge phrases total 15)
is quoted in full in this doc. Reusable, business-agnostic prompts for running this kind of
review on any `checks.coverage` structure, plus a validated negative result against
`README.md`/`docs/architecture.md`, the `atLeast` closure's own dogfood/adversarial-review
evidence, and `checks.freshness`'s own real dogfood run and dogfooding decision (NOT enabled
in this repo's own `.cairnrc.json` — no real "doc silently rotted" incident here to ground a
threshold in, unlike the repo that motivated it), are in
[`review-prompts.md`](./review-prompts.md).

The JSON-Schema cross-field-constraint gap (four decode-time checks invisible to an editor's
autocomplete) is now split three ways: the DISCOVERABILITY half is closed for all four
(`jsonSchemaHint`, an `allOf: [{ description }]` fragment each now carries); one of the four
(`atLeast.of`'s no-duplicate-target check) is now ALSO closed structurally, via `effect`'s
built-in `Schema.isUnique()` mapping onto the real `uniqueItems: true` JSON Schema keyword,
confirmed both by regenerating `schema/cairn.schema.json` and by validating the result with a
real, independent JSON Schema engine (`ajv`) rather than just re-reading the generated file; the
other three cross-field checks (`n <= of.length`, the `to` array's `minItems`, the top-level
undeclared-kind-id check) remain genuinely unexpressible in plain JSON Schema.

Full historical narrative (what was tried, what failed, what was found) is in
`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md`'s amendments.
