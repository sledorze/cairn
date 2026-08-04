# The design-package convention (and how it's structurally enforced)

## Why this exists

A design package (`docs/design/<slug>/`) is deliberately **plain Markdown prose**, not a
generated artifact — the reasoning, evidence, and tradeoffs it records need a human (or an
agent) to actually think and write, not fill in a template mechanically. But prose alone
has no way to guarantee a package is actually COMPLETE: nothing stops an author from
skipping the spikes, or writing a roadmap with no evidence behind it, and nothing would
notice.

The existing `checks.coverage` feature (kinds/rules — see the README,
`docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`) already expresses
doc→doc obligations generically, so it also enforces a design package's required shape —
no new config primitive was needed (see
`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md` for the
decision and its history).

## The convention

A design package is a directory `docs/design/<slug>/` containing:

- `_SUMMARY.md` — the package's own index, linking every child doc below.
- `problem-space.md` — what we're actually trying to address: the real need, market, or
  context this work responds to, not just its technical symptom. A bug report or failed
  spike is EVIDENCE the problem exists, not the problem itself — "`--refs` fails on every
  unrelated edit" is a symptom; "citing real implementation from docs stops being viable
  once citation and code-change frequency collide" is the actual need underneath it. Also
  carries the root cause, constraints on any fix, and an honest evidence basis (how many
  real reports this rests on — one anecdote, or corroborated context).
- `solution-space.md` — candidate directions, evaluated and ranked; rejects recorded, not
  silently dropped.
- `spikes.md` — feasibility evidence actually RUN, not assumed.
- `story-map.md` — the real user workflow, mapped to stories and a walking-skeleton slice.
- `roadmap.md` — shippable increments, with migration notes.
- `implementation-details.md` — concrete enough to start from.
- `knowledge.md` — the reusable technique, for whoever extends this later.

`cairn init --agent claude` scaffolds a skill file
(`.claude/skills/cairn-design-package/SKILL.md`, sourced from `DESIGN_PACKAGE_SKILL_BODY`
in `src/init/content.ts`) that teaches this shape — the seven documents, sibling-scoped
kinds, and rule-naming vocabulary below — to any cairn consumer.

Any consumer of `cairn` can adopt this exact shape for their own design work by copying the
`checks.coverage` block below into their own `.cairnrc.json` — nothing here is specific to
cairn's own repo beyond the `docs/design/` path, which is itself just a convention, not a
hardcoded assumption.

## The config that enforces it

```json
"checks": {
  "coverage": {
    "kinds": [
      { "id": "design-package", "select": { "by": "path", "glob": "**/docs/design/*/_SUMMARY.md" } },
      { "id": "problem-space", "select": { "by": "path", "glob": "**/docs/design/*/problem-space.md" } },
      { "id": "solution-space", "select": { "by": "path", "glob": "**/docs/design/*/solution-space.md" } },
      { "id": "spikes", "select": { "by": "path", "glob": "**/docs/design/*/spikes.md" } },
      { "id": "story-map", "select": { "by": "path", "glob": "**/docs/design/*/story-map.md" } },
      { "id": "roadmap", "select": { "by": "path", "glob": "**/docs/design/*/roadmap.md" } },
      { "id": "implementation-details", "select": { "by": "path", "glob": "**/docs/design/*/implementation-details.md" } },
      { "id": "knowledge", "select": { "by": "path", "glob": "**/docs/design/*/knowledge.md" } }
    ],
    "rules": [
      { "from": "design-package", "scope": "sibling", "to": "problem-space" },
      { "from": "design-package", "scope": "sibling", "to": "solution-space" },
      { "from": "design-package", "scope": "sibling", "to": "spikes" },
      { "from": "design-package", "scope": "sibling", "to": "story-map" },
      { "from": "design-package", "scope": "sibling", "to": "roadmap" },
      { "from": "design-package", "scope": "sibling", "to": "implementation-details" },
      { "from": "design-package", "scope": "sibling", "to": "knowledge" }
    ]
  }
}
```

A rule marked `scope: "sibling"` is satisfied only by a `to`-kind doc in the SAME parent
directory as the `from` doc. Combined with wildcard `kinds` globs, one generic block covers
every design package at once — present and future, at any nesting depth
(`docs/design/<slug>/`, or `docs/design/<time-bucket>/<slug>/` if organized by
sprint/cycle/quarter later) — with zero additional config per package.

The single `*` (not `**`) between `docs/design/` and the filename matters: `**` can match
zero segments, which would make `docs/design/_SUMMARY.md` itself (the parent index, not a
package) match the `design-package` kind.

Rule and kind matching is kind-based, not filename-based: a rule is satisfied by any doc
matching the `to` kind's glob in the same directory, so an author is free to name their own
files however they like — this repo's `problem-space.md`/`solution-space.md`/... naming is
one convention, not something `checks.coverage` itself requires.

## Linking to a dev issue, and the product-issue idea

Each design package links its originating GitHub issue from the first substantive mention
in the package (one authoritative link is enough to establish the relationship — see the
`grounded_by`-style discipline in the rule-naming vocabulary below).

This link is enforced: `checks.coverage`'s `CoverageTarget` has a third variant,
`{ external: 'url', pattern: '...' }`, satisfied by a doc's outbound link whose raw href
CONTAINS `pattern` (a plain substring match, not a regex/glob). This repo's own
`.cairnrc.json` uses it — `problem-space` must link something matching
`https://github.com/sledorze/cairn/issues/`:

```json
{
  "description": "The originating GitHub issue must be linked from problem-space.md — the evidence basis this design package rests on.",
  "from": "problem-space",
  "name": "traces_to",
  "to": { "external": "url", "pattern": "https://github.com/sledorze/cairn/issues/" }
}
```

A related, larger idea — linking design packages to a "product issue" layer (interview or
user-experience feedback that shapes vision, upstream of any specific dev issue) — is not
modeled by this convention. This repo has no real product/customer-feedback content to
ground such a model in; see
`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md` for the
reasoning behind leaving it unmodeled.

## A vocabulary for rule names

A `CoverageRule`'s `name` (e.g. `grounded_by`) disambiguates two rules that share the same
kind pair. On its own, in a report line (`no link ("grounded_by") to a "spikes"-kind doc`),
a `name` is a label, not an explanation — pairing it with a `description` (`core/Config.ts`)
gives the reader in-context guidance instead of a term to look up elsewhere.
`description` is required whenever `name` is set (enforced by a decode-time check); an
unnamed rule's default report line can stand on its own, so `description` isn't required
there. `description` is unconditionally required on every `KindDef`, since a kind id has no
generated sentence around it the way a rule's report line does.

Example report line with a `description`:

```
❌ 1 doc(s) missing required coverage:
  docs/design/101-refs-symbol-scoping/solution-space.md
    ✗ no link ("grounded_by") to a "spikes"-kind doc (required by kind "solution-space")
      A cost/feasibility/risk claim needs real evidence — cite the spike that backs it.
```

Choosing a rule name means re-reading the actual sentence making the claim and picking the
word that's true of that relationship, not the most generic-sounding one. For example, in
this repo's own rules, `solution-space`/`roadmap`/`problem-space` → `spikes` are each an
ARGUMENT citing spike evidence as support (`grounded_by`), while `implementation-details` →
`spikes` builds on a spike's validated approach (`builds_on`) and `knowledge` → `spikes`
restates content directly from the spike (`sourced_from`) — three different relationships
that an earlier, single `grounded_by` catch-all had conflated.

A reference vocabulary, drawn from established fields rather than invented per-edge:

**Requirements traceability** (also used in
`docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`): `implements`,
`verifies`, `verified_by`, `satisfies`, `derives_from`, `refines`, `traces_to`,
`depends_on`, `realizes`, `conforms_to`, `specializes`, `generalizes`.

**Toulmin argumentation theory** (claim / grounds / warrant / backing / qualifier /
rebuttal): `grounds` / `grounded_by`, `warrants`, `backs` / `backed_by`, `qualifies`,
`rebuts` / `rebutted_by`, `refutes`, `supports`, `contradicts`, `undermines`,
`corroborates`.

**Evidence / epistemic relations**: `evidences` / `evidenced_by`, `justifies`,
`substantiates`, `validates`, `confirms`, `disconfirms`, `motivates`, `informs`.

**Lineage / process relations** (how a doc came to exist, not what it claims):
`derived_from`, `sourced_from`, `distilled_from`, `builds_on`, `supersedes`, `deprecates`,
`amends`, `extends`, `elaborates`, `clarifies`.

## Judging this convention

Two claims about this convention have been checked against real content in this repo.

**Claim 1 — "the content this convention produces has clear purpose encoding for both
development AND product audiences."** Holds for a developer reader: a real captured report
(`✗ no link ("requires") to a "spikes"-kind doc ... skipping it means claims rest on
assumption, not evidence`) is specific and actionable without prior context, because
`description` (above) makes it so. The product angle does not hold: in this repo's own
`docs/design/101-refs-symbol-scoping/` package, `problem-space.md`'s "evidence basis" is a
single GitHub issue filed by cairn's own maintainer, not market or customer signal;
`story-map.md`'s "personas" are internal engineering roles (doc author, contributor,
maintainer, CI pipeline), not customer segments; `roadmap.md`'s rationale is dependency
sequencing, not business tradeoff. The filenames borrow product vocabulary
(`problem-space`, `story-map`, `roadmap`), but `checks.coverage` only enforces link
EXISTENCE — it does not and cannot check whether the linked doc's content is actually
product-shaped versus a restated bug report wearing a product-sounding filename.

**Claim 2 — "the config mechanism can express whatever document structure is actually
necessary, not just this repo's fixed 7-doc shape."** Does not hold, per
`core/Config.ts`/`core/structure/Coverage.ts`: `KindSelector` has two variants (`by: 'path'`,
glob-only, or `by: 'frontmatter'`, a flat YAML field/value match — still no way to target one
SPECIFIC instance, only a path- or frontmatter-shaped class); `CoverageTarget` has three
variants (a kind id, `{ external: 'path' }` resolved against a real file on disk, or
`{ external: 'url', pattern }` resolved against a substring match on a link's raw href — a
GitHub issue link is now enforceable, but only via a plain substring, not a real URL grammar:
no scheme/host/path-segment structure, no wildcard, so a pattern that's too loose (e.g. just
`github.com`) silently accepts a link to the wrong repo); `scope` has two variants (`'sibling'`
or `{ under: 'some/dir' }`, both narrower than absent/corpus-wide — the sibling/corpus-wide
granularity gap this claim originally named is closed, see "Self-reported-gap closure
tracking" below, and the `under`-vs-`roots` gap named in an earlier review round is now closed
too, though NOT the way the kind-id cross-field check closes its own equivalent gap: `roots`
and `checks.coverage` are sibling top-level fields that can be set in different `extends`
layers, so no single-layer schema decode can see both at once the way `CoverageInputSchema`'s
cross-field check sees `kinds`/`rules` together — the fix lives at `checkCoverage` RUN time
instead (`program/structure/CheckCoverage.ts`'s `emptyScopeUnders`), once every layer is folded
and the real doc corpus is scanned: a typo'd or out-of-corpus `under` is now a non-fatal warning
naming the exact value, not silent. See `review-findings.md` section 3 for the real dogfood/
falsification evidence and an independent adversarial pass's findings on both this and the next
gap); `CoverageRequirement.by` is still a single variant (`'link'`), but the N-of-M/alternation
gap this named is now CLOSED, on `to` rather than `by`, in two increments: `to` may be a single
target (unchanged), a non-empty ARRAY of targets — or the equivalent, explicitly-named
`{ any: [...] }` — satisfied by a link matching ANY ONE of them (`targetsOf`, `core/Config.ts`),
which closed the "either A or B" (OR/alternation) reading of this gap first; and now
`{ atLeast: { n, of } }` (`quantifierOf`, `core/Config.ts`; `core/structure/Coverage.ts`'s
`RuleEdge.satisfied`), satisfied when at least `n` of `of`'s targets EACH have their own
satisfying link, which closes the general N-of-M cardinality reading the first increment
deliberately left open (e.g. "at least 2 of these 3" — a single link is not enough, unlike the
OR shape). "All of these" needed no separate variant: it's `n: of.length` over the same shape,
not a fourth `to` case. See `review-findings.md` section 3 for the OR-only increment's dogfood/
falsification evidence and its independent adversarial pass, and section 4 for the `atLeast`
increment's own.

The dates/mtimes gap this paragraph originally named is now CLOSED, but NOT inside
`checks.coverage` — as its own separate, minimal `checks.freshness` check
(`core/structure/Freshness.ts`, `program/structure/CheckFreshness.ts`), opt-in via mere
presence like `coverage`/`docCoverage`. **Why not a `CoverageRule` field**: freshness turned
out to be a genuinely different AXIS from everything else this section discusses — TEMPORAL
("how old is this doc, per its real git history") rather than RELATIONAL ("does this doc link
to that doc"). Bolting a `maxAgeDays` onto `CoverageRule` would have repeated the exact
"one bespoke variant per round" growth pattern the "Noted-but-deferred structural observation"
paragraph below already flags as a design smell for `scope` — so it's wired independently
instead, the same way `checks.docCoverage` itself is independent of `checks.coverage` rather
than a field grafted onto it. See `review-findings.md` section 5 for the real dogfood/
falsification evidence, including the falsestart origin below.

**The falsestart context.** This gap wasn't hypothetical — it's the SAME real incident
`docs/design/101-refs-symbol-scoping/problem-space.md` documents (GitHub issue #101); the full
incident narrative (what was cited, what failed, why) is recorded once, in `review-findings.md`
section 5, rather than repeated here. In short: reflexive re-stamping, a gate cleared without
reading. Issue #101 named two candidate fixes for THAT specific symptom
(API-surface hashing, symbol-scoped references — both about narrowing WHAT `--refs` hashes)
and explicitly named a third, adjacent concept in passing: "the failure a freshness check
exists to prevent." `checks.freshness` is that third concept, built as its own thing rather
than as a fix to `--refs` — it doesn't ask whether a doc's CITED content changed at all, only
whether the doc itself has been touched recently per its own configured threshold. The two
are complementary, not alternatives: `--refs` (once issue #101's own narrower-granularity work
lands) catches "this doc's claims may now be wrong because what it cites changed";
`checks.freshness` catches "nobody has looked at this doc in N days, regardless of whether
anything it cites moved" — the falsestart session's own frustration was specifically with the
FIRST kind of check misfiring on drift that carried no information, not with staleness having
no detector at all; `checks.freshness` is deliberately narrow enough not to reintroduce that
same reflexive-gate failure mode itself (a doc with no real edits and no expired threshold
stays silent).

A third, adjacent structural critique was raised alongside this round's `atLeast` work but
DELIBERATELY NOT BUILT: unifying `scope: 'sibling'` and `scope: { under: '...' }` into one
general path-relation primitive. Recorded as noted-but-deferred, not silently generalized or
silently dropped — see the dedicated paragraph below.

**Noted-but-deferred structural observation: `scope` path-relation unification.** `scope`
(`core/Config.ts`'s `CoverageRuleScopeInputSchema`) has exactly two real variants —
`'sibling'` (same parent directory) and `{ under: 'some/dir' }` (nested anywhere below a named
directory) — plus the unscoped, corpus-wide default. Structurally, both named variants are
really the SAME kind of fact: "the `to`-kind doc's path stands in a particular relation to the
`from`-kind doc's path, expressed as a directory template." A more general primitive (e.g. a
single path-relation/template field capable of expressing `'sibling'`, `{ under }`, and
whatever a THIRD scope relation turns out to need, in one shape rather than one union variant
per relation) was raised as a critique of `CoverageRuleScopeInputSchema`'s own growth pattern —
`'sibling'` first, `{ under }` added later as a second, structurally similar but syntactically
unrelated variant. **Why it is not being built now**: this repo's own guidance (`AGENTS.md`:
"three similar lines is better than a premature abstraction... don't design for hypothetical
future requirements") applies directly here — TWO data points (`'sibling'`, `{ under }`) is not
enough evidence to design a general primitive against. A general path-relation template would
have to guess at a shape flexible enough for relations neither variant has needed yet (a sibling
of a sibling? an ancestor-of-`n`-levels? a relation keyed off a THIRD field, not just path
nesting?) — without a real third case grounding what that flexibility should actually look
like, the "general" primitive would just be invented complexity wearing a more abstract-sounding
name, exactly the failure mode `CoverageRequirement.by`'s own comment already warns against for
a different field (room for a REAL future variant is fine; a speculative one designed before its
second concrete instance exists is not). Two named, independently-motivated union variants are
also not yet a maintenance burden: each was added, tested, and dogfooded on its own (see
`review-findings.md` sections 2 and 3), and `scripts/coverage-metrics.ts`'s schema variant census
already tracks `CoverageRule.scope`'s variant count over time, so a THIRD ad hoc variant showing
up later would itself be visible, measurable evidence — not a silent surprise. **What would
justify revisiting it**: a genuine third scope-relation requirement surfacing from REAL use (a
real config that needs a path relation neither `'sibling'` nor `{ under }` can express, the same
bar every other gap in this section is held to — "attempted against the schema," not merely
imagined), not a fourth round of this same introspective review re-noticing the same two data
points. Until then, this observation itself — "we considered generalizing `scope` and chose not
to, and why" — is recorded here as a real, useful finding in its own right, distinct from either
silently generalizing prematurely or silently ignoring a structurally-valid critique.

A prompt for re-checking these two claims later, and reusable checklists for applying the
same kind of review to `checks.coverage` in any other domain, live in
[`review-prompts.md`](./review-prompts.md); the real, dated evidence from every round of
actually running those prompts against this repo (and others) lives in
[`review-findings.md`](./review-findings.md).

**Measurable checks, compiled from both claims above — track these as numbers over time,
not prose:**

- **Product-signal lexicon ratio**: grep each `problem-space.md`/`story-map.md`/
  `roadmap.md` for product-signal terms (`user segment`, `customer`, `market`, `revenue`,
  `competitor`, `interview`, `willingness to pay`, `retention`) versus dev-signal terms
  (`API`, `hash`, `CLI`, `flag`, `dependency`, `scanner`, `sidecar`). A near-zero
  product-term ratio against a doc named `problem-space.md` is the measurable form of
  Claim 1's failure.
- **Persona audit**: grep every `story-map.md` for `As a ` and list the extracted role
  nouns; flag when every persona is an internal engineering role rather than an external
  customer/user of the thing being built.
- **Evidence-source classifier**: for each `problem-space.md`'s evidence-basis section,
  classify each citation as GitHub-issue-only versus interview/survey/support-ticket-volume/
  analytics; flag packages where 100% of cited evidence is a single maintainer-filed issue.
- **Schema variant census**: count `KindSelector.by`, `CoverageTarget`,
  `CoverageRequirement.by`, `CoverageRule.scope`, and `CoverageRule.to`'s Literal/Union
  variants — computed for real by `scripts/coverage-metrics.ts` (`pnpm run
coverage-metrics`) rather than hand-counted, since a prior round of this same review
  hand-counted `KindSelector.by` as 1 and it silently went stale the moment
  `by: "frontmatter"` was added. `CoverageRule.to` was added as its own tracked counter in
  this round: the N-of-M/alternation gap (sections 5-6 below) grew `to`
  (`CoverageTargetOrAlternativesInputSchema`) from a single target to 4 variants (single,
  array, `{ any }`, `{ atLeast }`) — `CoverageRequirement.by` was the field this doc
  originally expected that growth to land on, but it stayed a single `'link'` literal
  throughout (see that field's own comment in `Config.ts`: growing `by` would have needed an
  extra field naming which OTHER rule to alternate with, a bigger shape change than the gap
  needed) — so without a dedicated `to` counter, this exact growth would have been invisible
  to this census even though it's the single largest variant-count change tracked here.
  Current real output:

  ```
  Schema variant census (src/core/Config.ts):
    KindSelector.by:          2
    CoverageTarget:           3
    CoverageRequirement.by:   1
    CoverageRule.scope:       2
    CoverageRule.to:          4
  ```

  Keep a running log of real requests that needed a variant that doesn't exist yet — a
  rising unmet-request count against a static variant count is Claim 2's gap growing,
  numerically, not just narratively.

- **Self-reported-gap closure tracking**: this doc originally named two open gaps
  (URL-pattern target, product-issue/vision layer); a third (sibling/corpus-wide scope
  granularity) was named later, in Claim 2's own re-review. Three of the running total are now
  closed (`CoverageTarget`'s third variant; `CoverageRule.scope`'s `{ under: '...' }` variant,
  see `review-findings.md`'s section 2 for the real dogfood/falsification evidence) — closing the
  scope-granularity gap surfaced a new, narrower one in its place (`under` had no validation
  against `roots`), which is itself the expected shape of this tracking: closing a gap can
  reveal a smaller one underneath, recorded rather than glossed over. That narrower gap is now
  ALSO closed, though at run time rather than decode time (a real architectural difference from
  the kind-id cross-field check's own decode-time guarantee, not an oversight — `roots` and
  `checks.coverage` can live in different `extends` layers, so no single-layer decode can see
  both), and the N-of-M/alternation gap is now FULLY closed, in two increments (the
  OR/alternation reading first, via an array `to`/`{ any }`; then general N-of-M cardinality,
  via `{ atLeast: { n, of } }`) — see `review-findings.md`'s section 3 for the OR-only
  increment's real dogfood/falsification evidence and an independent adversarial pass's
  findings, and section 4 for the `atLeast` increment's own. A related structural critique
  (unifying `scope`'s two variants into one general path-relation primitive) was raised in the
  SAME round `atLeast` closed and deliberately NOT built — see the dedicated "Noted-but-deferred
  structural observation" paragraph above; recorded as considered-and-declined, a third category
  distinct from both "closed" and "open" in this tracking. The dates/mtimes (freshness) gap
  named in this same re-review is now ALSO closed — as its own separate `checks.freshness`
  check, deliberately NOT a `CoverageRule` field, per the dedicated paragraph above; see
  `review-findings.md` section 5 for its real dogfood/falsification evidence. The
  product-issue/vision layer remains open. On a fixed cadence (e.g. every time this doc is next
  substantively edited), check whether a remaining gap has a real filed GitHub issue; an item
  surviving multiple such checks with no filed issue is a signal the "future work" framing has
  gone stale, not active.
- **JSON-Schema cross-field-constraint gap — investigated for real, partially closed, and the
  remainder now precisely explained rather than left as a vague "pre-existing" note.**
  `schema/cairn.schema.json` (generated by `scripts/generate-schema.ts` via `effect`'s
  `Schema.toJsonSchemaDocument`) only ever reflected SINGLE-FIELD constraints (e.g.
  `atLeast.n`'s own `minimum: 1`) — every CROSS-FIELD/cross-element decode-time check in
  `core/Config.ts` (the `to` array's non-empty check, `atLeast.n <= atLeast.of.length` plus its
  no-duplicate-target check, `under`'s non-empty-after-trim check, and the top-level
  undeclared-kind-id/description-mandatory-when-named check) was invisible to an editor's JSON
  Schema autocomplete/tooltip, even though `cairn check` still caught the real violation at
  runtime. Investigated directly against `effect@4.0.0-beta.102`'s own source, not assumed:
  `internal/schema/toJsonSchemaDocument.ts`'s `compileCheck` unconditionally drops a
  `Schema.Filter` that carries no `toJsonSchema` annotation callback
  (`if (check._tag === "Filter") return undefined`) — confirmed by a standalone
  `Schema.toJsonSchemaDocument` probe reproducing exactly this silent drop. What the same
  function ALSO does, confirmed by the same probe: when a filter's `annotations` DOES carry a
  `toJsonSchema` callback — even a no-op `() => ({})` — `compileCheck` takes its other branch,
  which merges in `collectJsonSchemaAnnotations(annotations, ...)`, and that function DOES read
  a plain `description` string. So a real, honest, additive fix exists and is now applied
  (`Config.ts`'s `jsonSchemaHint` helper, used by all four cross-field filters above): each now
  carries a `description` + no-op `toJsonSchema` annotation, which shows up in
  `schema/cairn.schema.json` as an `allOf: [{ description: "..." }]` fragment an editor's
  tooltip renders as prose. This closes the DISCOVERABILITY half of the gap (a reader can now
  see the constraint exists and what it means) but deliberately NOT the STRUCTURAL half:
  `cairn`'s own filters express arbitrary predicates (element-to-element duplicate checks,
  one-field-compared-to-another's-length checks) that plain JSON Schema draft 2020-12 keywords
  (`minItems`, `dependentSchemas`, `if`/`then`) cannot encode for the general case even in
  principle, and `Schema.toJsonSchemaDocument` makes no attempt to special-case an arbitrary
  user-supplied filter predicate into a structural fragment — an editor still cannot flag the
  violation before `cairn check` runs; only after this fix can it at least SAY what the rule is.
  A real, sharp-edged pitfall was found and fixed while implementing this, not merely
  disclosed: `.annotate()` chained directly after `.pipe(Schema.check(...))` on the SAME schema
  node overwrites that check's own `description` rather than adding a second, separate one (the
  two descriptions silently collapse to whichever is applied last) — caught for real via the
  same standalone probe (`ScopeUnderPathSchema`'s `under` field lost its own filter's hint this
  way on first write); fixed by reordering to `.annotate()` BEFORE `.pipe(Schema.check(...))`,
  confirmed both descriptions now coexist in `schema/cairn.schema.json`'s
  `CairnCoverageRuleScopeUnder.properties.under`. An independent adversarial pass and its own
  steelman surfaced one real, narrower follow-up this framing understated: `atLeast.of`'s
  no-duplicate-target half specifically IS expressible via the standard `uniqueItems: true`
  JSON Schema keyword — not attempted in that round, a genuine smaller open item, distinct from
  the `n <= of.length`/undeclared-kind-id checks which remain unexpressible in plain JSON
  Schema. Full investigation, falsification, and adversarial pass: `review-findings.md` section 6.
  **Update, a later round**: that narrower `uniqueItems: true` follow-up is now closed too —
  `AtLeastTargetInputSchema`'s `of` field (`Config.ts`) additionally carries `effect`'s own
  built-in `Schema.isUnique()` filter. Confirmed genuinely working, not assumed: the regenerated
  `schema/cairn.schema.json` now carries `"of": { "allOf": [{ "uniqueItems": true }], ... }`, and
  — going one step further than every prior `jsonSchemaHint` fragment in this file, none of which
  had been checked against a real validator before — compiling that regenerated schema with a
  real, independent JSON Schema engine (`ajv`) confirms it actually rejects a duplicate
  `atLeast.of` target and accepts a clean one, not just that the keyword appears in the generated
  text. A first-pass assumption that this check would be "strictly weaker" than the pre-existing
  `atLeastSaneFilter` duplicate-target check (reasoned as reference-equality-based, kept as
  harmless defense-in-depth alongside it) was WRONG, caught by this repo's own coverage ratchet
  rather than left uncorrected: `effect`'s `Equal.equals` is actually STRUCTURAL and
  key-order-INSENSITIVE, making `Schema.isUnique()` a strict superset of the old check (and fixing
  a real latent key-order bug in it), and field-level checks run before a struct's own cross-field
  check in this schema library — together making the old duplicate-target branch permanently
  unreachable. Fixed by REMOVING that now-dead branch from `atLeastSaneFilter`'s underlying
  function (not suppressing the resulting coverage gap); `atLeastSaneFilter` still owns the two
  cross-field checks `Schema.isUnique()` genuinely cannot express (`n <= of.length`, non-empty
  `of`). This closes the one structural piece of the four cross-field checks that a real JSON
  Schema keyword could express; the other three (`n <= of.length`, the `to` array's `minItems`,
  the top-level undeclared-kind-id check) remain genuinely unexpressible, unchanged from the
  prior round's conclusion. See `review-findings.md` section 7 for the full investigation,
  falsification, and adversarial steelman pass.
- **Hedge-language census**: grep this repo's own configs/ADRs/CONVENTION.md for hedge
  phrases (`not modeled`, `un-enforced`, `out of scope`, `no concept of`) — each marks a
  self-admitted gap already found by review; whether this count shrinks or grows release
  over release is a direct measure of whether reviews like this are actually closing gaps
  or just re-discovering and re-recording the same ones. Also computed for real by
  `scripts/coverage-metrics.ts` (across `docs/**/*.md`, excluding the `.cairn/` sidecar
  tree). Current real output:

  ```
  Hedge-language census (docs/**/*.md, excluding .cairn/):
    "not modeled":            4
    "un-enforced":            2
    "out of scope":           6
    "no concept of":          3
    total:                    15
  ```

Neither Claim 1's nor Claim 2's gap is closed by this section — both are recorded as open,
exactly like the URL-target and product-issue gaps above, rather than treated as solved by
writing about them.
