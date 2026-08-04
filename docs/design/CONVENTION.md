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

This link is real but currently unenforced: `checks.coverage`'s `CoverageTarget` classifies
real files by path glob, or `{ external: 'path' }` against a file on disk — it has no
variant for an external URL, so "every design package must link a real GitHub issue" isn't
expressible as a `checks.coverage` rule today. Enforcing it would need a new
`CoverageTarget` variant (e.g. `{ external: 'url', pattern: '...' }`).

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
`core/Config.ts`/`core/structure/Coverage.ts`: `KindSelector` has exactly one variant
(`by: 'path'`, glob-only — no way to target one specific instance, only a path-shaped
class); `CoverageTarget` has exactly two variants (a kind id, or `{ external: 'path' }`
resolved against a real file on disk — no URL/pattern variant, so a GitHub issue link can
never be enforced, only asserted in prose); `scope` is a single literal (`'sibling'` or
absent/corpus-wide — no granularity in between, e.g. "anywhere under this sub-tree" or "any
doc in a named group"); `CoverageRequirement.by` is a single variant (`'link'`, meaning "at
least one" — no `minCount`/N-of-M/alternation construct, so two rules on the same `from` are
always AND'd, never OR'd); and nothing in the schema touches dates/mtimes at all, so a "doc
must be re-validated after N months" freshness rule is outside its vocabulary entirely, not
just unconfigured.

A prompt for re-checking these two claims later, and reusable checklists for applying the
same kind of review to `checks.coverage` in any other domain, live in
[`review-prompts.md`](./review-prompts.md).

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
  `CoverageRequirement.by`, and `CoverageRule.scope`'s Literal/Union variants — computed for
  real by `scripts/coverage-metrics.ts` (`pnpm run coverage-metrics`) rather than
  hand-counted, since a prior round of this same review hand-counted `KindSelector.by` as 1
  and it silently went stale the moment `by: "frontmatter"` was added. Current real output:

  ```
  Schema variant census (src/core/Config.ts):
    KindSelector.by:          2
    CoverageTarget:           2
    CoverageRequirement.by:   1
    CoverageRule.scope:       1
  ```

  Keep a running log of real requests that needed a variant that doesn't exist yet — a
  rising unmet-request count against a static variant count is Claim 2's gap growing,
  numerically, not just narratively.

- **Self-reported-gap closure tracking**: this doc names two open gaps (URL-pattern target,
  product-issue/vision layer). On a fixed cadence (e.g. every time this doc is next
  substantively edited), check whether either has a real filed GitHub issue; an item
  surviving multiple such checks with no filed issue is a signal the "future work" framing
  has gone stale, not active.
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
