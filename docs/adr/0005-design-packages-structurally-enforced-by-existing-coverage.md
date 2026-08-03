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
