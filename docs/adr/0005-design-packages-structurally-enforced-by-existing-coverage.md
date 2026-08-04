---
status: accepted
---

# Design packages are structurally enforced by the EXISTING `checks.coverage` kinds/rules — no new config primitive

## Context

Working on [issue #101](https://github.com/sledorze/cairn/issues/101)'s own design package (`docs/design/101-refs-symbol-scoping/`), a
real question surfaced: these are hand-authored Markdown files (`problem-space.md`,
`solution-space.md`, `spikes.md`, `story-map.md`, `roadmap.md`,
`implementation-details.md`, `knowledge.md`) with no consistent internal heading schema
(verified: every file invents its own `##` section names) and no config representation at
all — nothing in `.cairnrc.json` said a design package needed these specific documents.
Two real risks follow: an author could skip a required piece of the shape (no spikes, no
story map) with nothing noticing, and the convention wasn't obviously reusable by anyone
outside this one repo — it existed only as an informal pattern this one PR happened to
follow.

## Decision

**No new config primitive.** `checks.coverage`'s existing `kinds`/`rules` mechanism
(`docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`) already expresses exactly what's needed: declare each required role
(`problem-space`, `solution-space`, `spikes`, `story-map`, `roadmap`,
`implementation-details`, `knowledge`) as a `kind` by path glob, declare a `design-package`
kind for each package's own `_SUMMARY.md`, and add one `{from: design-package, to: <role>}`
rule per required role. A package missing a required piece — or forgetting to link it —
reports as `missing coverage`, the same signal `checks.coverage` already gives for any
other doc→doc obligation.

Materialized in this repo's own `.cairnrc.json` (dogfooding, matching this repo's own
established practice for #108/#101) — see `docs/design/CONVENTION.md` for the full
reasoning, the exact config block (copy-pasteable by any cairn consumer for their own
design docs), and a real falsification (a link removed from `_SUMMARY.md`, caught three
independent ways at once: missing-coverage, orphan detection, and link-completeness;
restored, confirmed green again).

## Consequences

- **Reusable by any cairn consumer**, not just this repo: the config block in
  `docs/design/CONVENTION.md` is copy-pasteable into any `.cairnrc.json`. Kind-based, not
  filename-based — a different naming convention still works, as long as each required
  role has some doc filling it.
- **A real, documented limitation, not glossed over** — _**superseded, see the Amendment
  below**_: `checks.coverage`'s rules initially weren't scoped per-package — a rule was
  satisfied by a link to ANY doc of the right kind ANYWHERE in the corpus, not specifically
  the SAME package's own doc. Verified concretely (a throwaway second package cross-linking
  an existing package's docs passed cleanly). Originally recorded as an accepted, out-of-
  scope gap; turned out to need closing for real.
- No `core/Config.ts` schema change, no new CLI flag, no new check module — _**also
  superseded, see the Amendment below**_: a real core change (`scope: "sibling"`) was needed
  after all, once the per-package-scoping gap proved severe rather than theoretical.

## Alternatives considered

A dedicated `checks.designPackage`-style config key (a "directory must contain files X, Y,
Z" primitive) was the first instinct, but rejected: it would duplicate `checks.coverage`'s
existing kind-classification/rule-satisfaction machinery for no new expressive power this
repo's own case actually needed, and would be exactly the kind of premature new mechanism
`AGENTS.md`'s own "don't add abstractions beyond what the task requires" guidance warns
against.

## Amendment: the per-package-scoping gap DID need closing for real

This ADR originally accepted "not scoped per-package" as a documented limitation, with no
`core/Config.ts` change. Stress-tested further and found that gap severe, not theoretical: a
throwaway hollow package cross-linking a real sibling's docs passed `checks.coverage`
cleanly, with zero warnings — an author (or a generator) could satisfy the whole structural
check without writing a single real word. A first fix (per-package hand-scoped kind ids, no
core change) closed that but reopened the ORIGINAL problem this ADR exists to solve:
accidental incompleteness in any package nobody remembered to hand-configure went silently
uncaught, and `.cairnrc.json` would grow without bound as packages accumulated.

The actual fix needed the core change this ADR originally avoided: `scope: "sibling"`, a new
optional field on `CoverageRule` (`core/Config.ts`, `core/structure/Coverage.ts`) — a rule so
marked is satisfied only by a `to`-kind doc sharing the `from` doc's own parent directory.
One small, generic, wildcard-glob config block now closes both the capturability gap and the
onboarding gap at once, for every design package present and future, with zero per-package
config ever again — see `docs/design/CONVENTION.md`'s own "Is any of this actually
capturable?" section for the full three-round finding and the real falsification proving it.

Real cost of getting this wrong once already: adding `scope` without adding it to
`checkCoverage`'s rule-dedup key (`program/structure/CheckCoverage.ts`) would have silently
collapsed two same-pair rules differing only by `scope` — the FOURTH time this exact
dedup-key omission bug has been found in this feature's history (see that file's own
comment). Caught this time by applying the standing warning already written down, not by
re-discovering the bug in production.

A separate, additive `description` field (also on `CoverageRule`) shipped alongside `scope`
for an unrelated but related reason: `name` (e.g. `grounded_by`) was found to only ever feed
a bare disambiguating label into the report, never real guidance — a reader hitting the
message with no prior context had no way to know what it meant. `description` renders as an
actual guidance line under the missing-coverage message when present.

**Second amendment, same session**: `description` was made **mandatory whenever `name` is
set**, not left structurally optional — enforced by a decode-time cross-field check, the
same shape as the pre-existing undeclared-kind check above. Verified by real falsification: a
description removed from this repo's own `.cairnrc.json` made `cairn check` refuse to even
load the config, not just warn.

**Third amendment**: re-examining this repo's own 7 "design-package requires X" rules — left
unnamed on the theory their report line was already self-explanatory — found that theory
didn't survive contact with the real question "why DOES a design package need its own
spikes.md." All 13 rules in this repo's own config are now named with real descriptions; the
schema's exemption for a genuinely self-evident unnamed rule remains available but isn't the
default to reach for. The same principle was also extended to `KindDef`: a kind id
(`design-package`, `spikes`) has no auto-generated sentence around it the way a rule's report
line does, so `description` there is unconditionally required, not conditional on anything —
every one of this repo's 8 kinds now carries one.

## Amendment: rule-naming vocabulary refined by re-reading the actual claims

Early drafts of this package's own rules used `grounded_by` as a catch-all for every "X
cites spikes.md" edge. Re-reading the actual content each rule stood for found it was
quietly standing in for at least three different relationships: `solution-space` →
`spikes`, `roadmap` → `spikes`, and `problem-space` → `spikes` are each a genuine argument
citing spike evidence as support (Toulmin's `grounded_by`, kept); `implementation-details`
→ `spikes` is not an argument being supported but an implementation built on the spike's
validated approach (renamed `builds_on`); `knowledge` → `spikes` restates content directly
from the spike, not an argued claim (renamed `sourced_from`). The corrected rule names, and
a broader reference vocabulary (requirements-traceability terms, Toulmin argumentation
terms, evidence/epistemic terms, lineage/process terms) for whoever names the next rule, are
recorded in `docs/design/CONVENTION.md`'s "A vocabulary for rule names" section — the
takeaway generalizes: pick the word that's true of the specific sentence making the claim,
not the most generic-sounding term available.

## Amendment: dev-issue linking, and a deliberately unmodeled product-issue layer

Every doc in the `101-refs-symbol-scoping` package originally referenced "issue #101" as
plain, unlinked text. Fixed by adding one authoritative
`[issue #101](https://github.com/sledorze/cairn/issues/101)` link per doc (the first
substantive mention, not every occurrence). This link is real and useful but currently
unenforced: `checks.coverage`'s `CoverageTarget` classifies real files by path glob or by
`{ external: 'path' }` against a file on disk — it has no concept of an external URL as a
target, so "every design package must link a real GitHub issue" cannot be expressed as a
`checks.coverage` rule the way "must link a `spikes`-kind doc" can. Closing that gap would
need a new `CoverageTarget` variant (e.g. `{ external: 'url', pattern: '...' }`) — not
designed here, since it needs its own problem-space/solution-space treatment, not a
bolt-on paragraph.

A related, larger idea was raised alongside this and deliberately NOT modeled: linking
design packages not just to a dev issue (GitHub, this repo) but to a "product issue" layer
capturing feedback from interviews or real user experience that shapes vision, upstream of
any specific GitHub issue. This repo has no real content to ground that in — every issue
here is dev-flavored (dogfooded by the tool's own maintainer), not sourced from a separate
product/customer-feedback process. Modeling it here would mean inventing fictional
interview data to hang a schema on. Worth pursuing as its own scoped design package, filed
as a real GitHub issue first, once there's real product-issue content (this repo's own, or
a consumer's) to verify the model against.

## Amendment: scaffolded as a shipped skill, and judged by adversarial review

This convention is now materialized as a shipped skill, not just this repo's own docs:
`cairn init --agent claude` scaffolds a second skill file
(`.claude/skills/cairn-design-package/SKILL.md`, sourced from `DESIGN_PACKAGE_SKILL_BODY`
in `src/init/content.ts`) teaching the seven-document shape, sibling-scoped kinds, and
rule-naming vocabulary to any future cairn consumer — locked in with a real integration
test (`src/init/generate.integration.test.ts`).

Two context-free adversarial reviews were separately run against the convention's own
claims, refuting rather than confirming each: whether the enforced content has clear
purpose for both a developer and a product reader (holds for developer, refuted for
product — `checks.coverage` enforces link existence, not content shape), and whether the
`checks.coverage` schema can express whatever document structure a team actually needs
(refuted — `KindSelector`, `CoverageTarget`, `CoverageRequirement`, and `CoverageRule.scope`
are each single- or dual-variant today, unable to express a URL target, a scope narrower
than corpus-wide but broader than sibling, N-of-M alternation, or a freshness rule). Both
findings, a repeatable judge-prompt, and six measurable checks to re-run over time are
recorded in `docs/design/CONVENTION.md`'s "Judging this convention" section; two
business-agnostic prompts for running the same kind of review against any
`checks.coverage` structure are in `docs/design/review-prompts.md`.

## Amendment: the URL-pattern `CoverageTarget` gap closed

The previous amendment's self-reported gap — no way to enforce a link to an external URL —
is closed. `CoverageTarget` (`src/core/Config.ts`) gained a third variant, `{ external:
'url', pattern: string }`, purely additive: existing `{ external: 'path' }` and plain-kind-id
configs decode and behave identically. A rule with this `to` shape is satisfied by a doc's
outbound link whose raw href CONTAINS `pattern` — a deliberate plain substring match, not a
regex/glob DSL, matching the minimalism `CoverageRequirement.by`'s own single `'link'`
variant already established.

Resolving it needed one real structural change beyond the schema/resolution code itself:
`checks.coverage` had never looked at a URL-shaped link at all —
`core/structure/DocMetadata.ts`'s `extractDocMetadata` used `isCheckableTarget` to filter
`http(s)://…`/`mailto:…` targets OUT of `ref` nodes entirely (they're not a same-repo path
to resolve), so there was no data for a URL rule to match against even in principle. Fixed
by capturing a non-checkable target as its own `urlRef` node (raw href, unsplit — a GitHub
issue URL's own `#issuecomment-123` is part of the link, not a same-page anchor) rather than
folding it into `ref` — every existing `ref`-only consumer (`core/structure/DocGraph.ts`'s
inbound graph, `resolveRuleEdges`'s kind/path branches) needed zero changes, since a
`urlRef` node was simply never a `ref` node to begin with.

Dogfooded for real: `.cairnrc.json` now requires `problem-space` to link something matching
`https://github.com/sledorze/cairn/issues/` (named `traces_to`, with a `description` per
this repo's own mandatory-when-named rule). Verified against the real
`docs/design/101-refs-symbol-scoping/` package (already linking `issues/101`, per the
previous amendment) — `cairn check` passes. Falsified for real too: temporarily removing the
issue link from `problem-space.md` and re-running produced the expected `✗ no link
("traces_to") matching "https://github.com/sledorze/cairn/issues/"` failure line with its
`description` guidance; restoring the link returned to green.

The `{ external: 'url', pattern }` match is still just a substring, not a real URL grammar
(no scheme/host/path-segment structure) — CONVENTION.md's Claim 2 section flags this as the
remaining sharp edge (a too-loose pattern like `github.com` would silently accept a link to
any repo, not just this one). The product-issue/vision layer from the previous amendment
remains open and unmodeled.

## Amendment: the `scope` sibling/corpus-wide granularity gap closed — and one new, narrower

gap found while closing it

Claim 2's own re-review named a third self-reported gap: `CoverageRule.scope` had exactly one
real value (`'sibling'`, exact same directory) plus the unscoped default (anywhere in the
corpus) — nothing in between, e.g. "anywhere under this named sub-tree." Closed additively:
`scope` gained a second variant, `{ under: 'some/project/relative/dir' }`
(`CoverageRuleScopeInputSchema` in `core/Config.ts`) — satisfied only by a `to`-kind doc whose
resolved path is nested anywhere below `under`, matched via `**/<under>/**` (root-independent,
same convention every kind's own `by: 'path'` glob already relies on), not a plain string-
prefix compare. `'sibling'` decodes and behaves identically — purely additive.

Real cost of getting this wrong once already, again: `program/structure/CheckCoverage.ts`'s
rule-dedup key (see that file's own "FIVE rounds so far" comment) previously coerced `scope`
via `${r.scope ?? ''}` — a template-literal string coercion that stringifies ANY object to the
literal text `"[object Object]"` regardless of its actual `under` value, so two rules differing
only by `under` (e.g. scoped to two different sub-trees) would have silently collapsed into
one. Caught before shipping this time (Round 5), by the same standing warning that comment
already carries — fixed by `JSON.stringify`-ing the whole `scope` field instead of relying on
coercion. Falsified for real: reverting the fix reproduces the collapse (a real test asserting
2 distinct `missing` entries reports 1 instead); restoring it returns to 2.

Dogfooded for real against a throwaway fixture mirroring two design-package "teams" (`docs/
design/team-a/`, `docs/design/team-b/`) with a `scope: { under: "docs/design/team-b" }` rule:
the real bundled CLI correctly reports `team-a`'s roadmap as missing coverage (it links a
spikes doc under `team-a`, outside the scoped sub-tree) while `team-b`'s own roadmap — linking
a spikes doc nested two directories further down inside `team-b` — passes cleanly, proving
"nested anywhere below," not just "directly in."

A second, more severe gap was found by an independent, context-free adversarial reviewer (a
fresh agent handed only the diff, asked to break it, with no prior investment in the design —
per this repo's own "run an adversarial review... before every push" practice) and fixed before
shipping, not merely disclosed: `scopeSatisfied` trims leading/trailing slashes off `under`
before building `**/${under}/**`, so an `under` that trims to EMPTY (`""`, `"/"`, `"///"`)
collapses that glob into one matching every path in the corpus. Proved concretely — with
`scope: { under: '/' }` configured, `resolveRuleEdges` reported a doc under `design/team-a/pkg/`
as satisfied by a totally unrelated doc under `unrelated/far-away/`. Worse than a disclosed
limitation: it fails SILENT (vacuously "satisfied," indistinguishable in a report from a real,
intentional scope) rather than loud. Fixed by rejecting, at decode time, any `under` that trims
to empty — the same `CoverageRuleScopeInputSchema` gains a `Schema.makeFilter` check. Falsified
for real: the same CLI that previously accepted `scope: { under: '/' }` and silently
cross-satisfied an unrelated doc now refuses to load that config at all.

A third, narrower gap was found in the course of closing the first one, applying the
adversarial-judge prompt to this task's own capability (`docs/design/review-findings.md`'s
section 2) — this one recorded as open, not fixed here: `under` is otherwise a plain string
with **zero validation against the config's real `roots`** — unlike `from`/`to` kind ids, which
`CoverageInputSchema`'s existing cross-field check already rejects at decode time when
undeclared (this ADR's own Decision section, and docs/adr/0002's Consequences, record exactly
why that check exists). A typo'd or out-of-scope `under` still decodes successfully and then
silently, permanently reports every rule using it as unsatisfiable, with nothing pointing at
the actual cause. Not fixed here — `CoverageInputSchema`'s own cross-field check only ever sees
`coverage.kinds`/`coverage.rules`, not the sibling top-level `roots` field, so closing this
needs either a `CairnConfigSchema`-level cross-field check (a different point in the schema
tree) or a runtime hint mirroring `unmatchedKinds`'s own non-fatal-warning precedent. Recorded
as open, not glossed over, matching this ADR's own established practice for every other
self-reported gap above.

## Amendment: the `under`-vs-`roots` gap closed at run time, and `to` gains OR alternation

The `under`-vs-`roots` gap the previous amendment recorded as open is closed — but at
`checkCoverage` RUN time (`program/structure/CheckCoverage.ts`), not decode time: `roots` and
`checks.coverage` are sibling top-level fields that can be set in different `extends` layers, so
no single-layer schema decode can see both the way `CoverageInputSchema`'s existing `from`/`to`
kind-id check sees `kinds`/`rules` together. Once every layer is folded and the real doc corpus
is scanned, a distinct `under` value matching zero scanned docs of any kind now surfaces as a
new, non-fatal `CoverageResult.emptyScopeUnders` warning — mirroring `unmatchedKinds`'s own
precedent (a kind matching 0 docs is a hint, not a hard failure, since mid-rollout is a
legitimate zero-docs state). Dogfooded for real against a throwaway typo'd fixture
(`under: "docs/desing/pkg"`) with the real bundled CLI: the warning names the exact typo'd
value; fixing the typo makes it disappear. Falsified: reverting `emptyScopeUnders` makes the new
tests fail with `[]` instead of the typo'd value; restoring makes them pass again.

Separately, in the same task, `CoverageRule.to` — not `CoverageRequirement.by`, which stayed a
single `'link'` literal — gained the ability to be a non-empty ARRAY of targets, satisfied by a
link matching ANY ONE of them (`targetsOf`, `core/Config.ts`): the OR/alternation reading of the
N-of-M gap `docs/design/CONVENTION.md`'s Claim 2 named. Real example:
`{ from: 'roadmap', to: ['spikes', 'evidence'] }` is satisfied by linking either kind. Every
existing consumer of `rule.to` was routed through the new `targetsOf`, and the rule-dedup key
(`program/structure/CheckCoverage.ts`) was made unconditional (`JSON.stringify(r.to)` always,
not only for object-shaped `to`) to avoid a sixth instance of that file's own standing
dedup-key-omission bug class. `schema/cairn.schema.json` regenerated, a changeset added.

An independent, context-free adversarial pass (a fresh agent given only the diff) found no
crash or silently-wrong-pass bug in either fix. It found two low-severity, non-exit-code
cosmetic gaps, recorded rather than fixed: the dedup key is order-sensitive for an array `to`
(`['spikes','evidence']` vs `['evidence','spikes']` don't dedupe), and `emptyScopeUnders`'s own
dedup is by untrimmed `under` string. It also confirmed one JSON-Schema gap is pre-existing, not
newly introduced by this task: the generated `schema/cairn.schema.json` has no `minItems: 1` on
the new array-`to` branch, the same limitation the existing `under` non-empty check already has
— `Schema.check` filters don't propagate into the generated JSON Schema in this codebase's
current setup (see `docs/design/CONVENTION.md`'s tracked-gaps text for the precise reason).
General N-of-M cardinality (not just "any one of these") remained explicitly open after this
amendment — closed by the next one. Full evidence: `docs/design/review-findings.md` section 3.

## Amendment: the general N-of-M/`atLeast` gap closed, and a vacuity safeguard catches a real bug in its own feature

The narrower N-of-M reading the previous amendment left open — "at least N of these, N > 1" —
is closed: `to` gains a third quantifier, `{ atLeast: { n, of } }`, satisfied when at least `n`
of `of`'s targets EACH have their own satisfying link (not `n` links to the same target); an
explicit `{ any: [...] }` spelling of the existing array/OR shape ships alongside it, purely for
naming symmetry. "All of these" needs no separate variant — it's `n: of.length` over the same
shape. `RuleEdge` gains a `satisfied` boolean field, since `satisfiedBy.length > 0` alone can no
longer answer "is this rule met" once a rule can require a minimum count across several distinct
targets. Dogfooded for real with the bundled CLI: reports missing when only one of a required
two targets is linked, goes silent the moment a second is added.

Since `fast-check` is confirmed absent from this repo's dependencies, the systematic vacuity
safeguard this task's own instructions called for instead took the form of a table-driven test
(`src/core/VacuousShapes.unit.test.ts`) covering every vacuity-prone shape found across this
feature's history in one place. Writing that table surfaced a REAL bug this task's own
first-pass self-review had not caught: a DUPLICATE target inside `atLeast.of` let one real
satisfying link count toward `n` TWICE (`countSatisfiedTargets` checked each `of` index
independently rather than each distinct target) — proved concretely
(`resolveRuleEdges` returning `satisfied: true` for `n: 2` against a doc with exactly one real
link), fixed at decode time before this task's own commit (`checkAtLeastSane` now rejects a
structurally-duplicate `of` entry, `JSON.stringify`-compared), and falsified both directions.

Running this repo's own adversarial-judge prompt (`docs/design/review-prompts.md`, with its
steelman-the-opposite second pass) against the shipped `atLeast` shape found one genuinely new
schema-fundamental gap not yet promoted into `docs/design/CONVENTION.md`'s tracked-gap list: `n`
is a literal integer, not an expression, so "at least half of `of`, however large `of` grows" is
unexpressible without hand-recomputing the number. It also found one configuration-only
ergonomic cost a first pass had understated: a per-`from`-doc minimum is expressible today only
via one additional `scope: { under }`-partitioned rule per distinct minimum, unlike the
zero-additional-config `scope: 'sibling'` pattern this ADR's own Decision section already
praises. Full evidence: `docs/design/review-findings.md` section 4.

## Amendment: the dates/mtimes gap closed — `checks.freshness`, a new, separate check

`docs/design/CONVENTION.md`'s remaining named schema gap — "nothing in the schema touches
dates/mtimes at all" — is closed, but deliberately NOT as a `CoverageRule` field: a new,
independent `checks.freshness` check (`core/structure/Freshness.ts`,
`program/structure/CheckFreshness.ts`), opt-in via mere presence like `coverage` itself.
Freshness is a genuinely different axis from everything else this ADR's amendments cover —
TEMPORAL ("how old is this doc, per its real git history") rather than RELATIONAL ("does this
doc link to that doc") — so bolting a `maxAgeDays` onto `CoverageRule` would have repeated the
exact "one bespoke variant per round" growth pattern `docs/design/CONVENTION.md`'s own
noted-but-deferred `scope`-unification paragraph already flags as a design smell.

Not hypothetical: the origin is the same real incident `docs/design/101-refs-symbol-scoping/
problem-space.md` documents (issue #101, found using cairn 0.6.0 in `sledorze/falsestart`) —
`docs/architecture.md` cited 14 implementation files, and `--refs` failed on every edit to any
of them even when the doc's own claims hadn't changed, "re-stamping became reflexive... the
failure a freshness check exists to prevent." `checks.freshness.rules` is an ordered
`{ glob, maxAgeDays }` array, first-matching-glob-wins; age is checked against `io/Git.ts`'s
real committer date, never filesystem mtime (a fresh clone/checkout resets mtime regardless of
real history); a doc with no commit history yet is silently excluded, not reported.

Dogfooded for real with the bundled CLI against a throwaway `.cairnrc.json` copy
(`maxAgeDays: 1`): correctly flagged this repo's own older ADR docs as stale with accurate
`(Nd > 1d)` ages, stayed silent on recently-touched docs. Deliberately NOT enabled in this
repo's own committed `.cairnrc.json`, though: this repo's docs are actively maintained by the
same people who write the code, and picking a real threshold with no genuine "this doc silently
went stale and nobody noticed" incident _here_ would be exactly the arbitrary,
evidence-free threshold `AGENTS.md`'s own "don't design for hypothetical future requirements"
guidance warns against — the real incident motivating this check happened in a different repo.
Full evidence, including the falsestart origin and full test coverage list:
`docs/design/review-findings.md` section 5.
