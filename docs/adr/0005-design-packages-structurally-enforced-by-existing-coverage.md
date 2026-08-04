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
