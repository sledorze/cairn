# Story map: issue #137 (typed relations)

**What this map actually is** (required, verbatim, across every design package's
story-map.md — this convention's own requirement): every role below is an internal
engineering role (doc author, reviewer, CI), not a customer or market segment. This
repo's design-package docs are dev-shaped content, not product/market research, despite
borrowing product vocabulary in their filenames (`story-map.md`, `roadmap.md`) — see
`docs/design/CONVENTION.md`'s own "judging this convention" section. A real relationship
with ANOTHER package (not an internal role within this one) belongs in
[`../dependencies.md`](../dependencies.md), not here.

Backbone = a doc author's actual workflow authoring and maintaining a claim-bearing
sentence, left to right.

## Backbone

`Write a claim about code` → `Declare its relation` → `Get evidence, or admit there is
none` → `Code changes` → `Re-run cairn check` → `Read the report` → `Fix the doc, or
confirm it still holds`

## Cards, by backbone step

### 1. Write a claim about code

- _As a doc author, I write a sentence like "the published tarball ships these six paths"_
  — existing behavior, unchanged; cairn has no opinion on prose today.
- _As a doc author, some of my claims have no natural link target_ (a set membership, a
  CLI's accepted flags, "this file is never imported below X") — the #130 case exactly.
  Today I have nowhere to put a machine-checkable version of that claim at all.
  _(Must — this IS the problem the whole issue exists to fix; the walking skeleton's own
  `covers set:published-files` is one concrete instance of it.)_

### 2. Declare its relation

- _As a doc author, I want to say what KIND of claim this is_ (enumerates a set / never
  contains a string / a command's output matches a fixture) so cairn can pick an
  appropriate check instead of treating every claim the same generic way. Foundational
  infrastructure every later card in this map depends on. _(Should — the walking skeleton
  hardcodes ONE kind (`covers`), so this doesn't need to be general yet.)_
- _As a doc author, I want to address the claim's object precisely_ — a whole file, one
  named symbol, a computed set, a command's output — without being forced to invent a fake
  link just to have somewhere to point. Directly resolves #130's "a relation needs no
  link." _(Must — the walking skeleton's own `set:published-files` object IS this capability,
  exercised for real in spike 7.)_
- _As a doc author, I must not be able to skip saying whether this claim is even checkable_
  — evidence is mandatory, with `open`/`declined "<reason>"` as honest escape hatches, so
  there's no unlabeled middle state. _(Should — real, but the walking skeleton's own single
  relation never needs the `open`/`declined` escape hatches to prove the concept.)_

### 3. Get evidence, or admit there is none

- _As a doc author, if my claim's predicate is one cairn can check generically, I want it
  checked automatically_ — no hand-written test file per claim, unlike today's
  `documented.test.ts` pattern this design generalizes from. One predicate at a time — see
  `roadmap.md`. _(Must — this IS spike 7's own proof: one generic comparison function,
  evaluated automatically.)_
- _As a doc author whose claim's predicate has no generic checker yet, I want that fact to
  be VISIBLE_ — a list of `open` relations, not silence, "gap reporting." _(Could.)_
- _As a doc author, I must not be able to satisfy my own claim by writing an annotation
  that names or quotes the very thing being claimed_ — the self-refutation hazard
  (`problem-space.md`, spike 4) must be structurally impossible, not just documented as a
  pitfall to avoid by hand. _(Should — a real hazard, examined in spike 4, but a DIFFERENT
  spike from spike 7's own walking-skeleton proof.)_

### 4. Code changes

- _As a contributor, editing `package.json#files` should make a doc's `covers
set:published-files` relation fail if the doc wasn't updated_ — the exact #130 incident,
  reproduced and proven catchable in `spikes.md` spike 7. _(Must — this bullet, verbatim,
  IS the walking skeleton's own proof point.)_
- _As a contributor, editing an unrelated part of a file a relation's object resolves
  against should NOT fail the relation_ — the same non-vacuous, precision-preserving
  requirement `101-refs-symbol-scoping/story-map.md` already states for `--refs`; typed
  relations must not regress it by being coarser than the existing mechanism where they
  overlap. _(Should.)_

### 5. Re-run `cairn check`

Non-negotiable engineering constraints, not user stories — same reasoning
`101-refs-symbol-scoping/story-map.md` gives for its own equivalent step: these attach to
this exact backbone step and belong in the map even though neither is a persona whose
journey this map otherwise traces. Only the masking guarantee below carries the
walking-skeleton tag — it's the one spike 7's own proof directly exercises (reuses
`maskFencedCode`, zero new masking primitive); the relation-error distinction is real but
untested by that spike, which targets one already-resolvable object.

- A relation's evaluation must never read its own annotation as part of the doc content
  it's evaluating — the single annotation-stripping helper (`problem-space.md`) is
  structural, not best-effort. _(Must.)_
- A relation whose declared object (`set:published-files`, `symbol:path#Name`, ...) cannot
  be resolved at all (typo'd slug, missing file) must be reported as a **relation error**,
  distinct from "the relation was evaluated and found false" — the same distinction
  `checks.coverage`'s `emptyScopeUnders` hint already draws for a config-level typo, applied
  here at the relation-declaration level.

### 6. Read the report

- _As a doc author, I want a decidable relation's failure and an undecidable relation's
  `open` status to be visibly DIFFERENT kinds of report line_ — directly resolves #133:
  grouping by predicate-derived modality is strictly stronger than #133's own proposed
  doc-vs-source split, because it's available for every relation, not only ones with a link.
  _(Must — spike 7's own proof needs a clear red/green report line at all; the #133
  modality distinction is the natural shape that line takes.)_
- _As a doc author, a vacuously-true comparison (a renamed heading, an empty set on both
  sides) must be reported as a GUARD FAILURE, not silently pass_ — spike 8's finding,
  applied. _(Should — a real, later-discovered (spike 8) robustness gap, not exercised by
  spike 7's own walking-skeleton demo.)_

### 7. Fix the doc, or confirm it still holds

- _As a doc author, fixing a relation's failure and re-running should go green for a
  verifiable, specific reason_ — proven end to end in spike 7 (BEFORE agree → AFTER drift,
  red, exact missing item named → fixed, green). _(Must — this is spike 7's own proof loop,
  verbatim.)_
- _As a maintainer, re-declaring a relation's evidence as `declined "<reason>"` should be a
  deliberate, reviewable act_ (it appears in the report, same as an `open` relation would),
  not a silent downgrade — mirrors this repo's own `checks.proseRefs.ignore` discipline, an
  exemption declared, not invisible. _(Could.)_

## Walking skeleton (the single (Must)-tagged card at each backbone step above marks it)

The walking skeleton is exactly the single **(Must)**-tagged card at each backbone step
above, concatenated left to right — every one traces back to spike 7's own end-to-end
proof, which is exactly why THAT proof is the walking skeleton and not a coincidence.
`checks.storyMapTiers` (see the repo's own `.cairnrc.json`) now enforces that every step
has exactly one, so this section can never silently drift from the tags again.

`covers set:published-files`, exactly as built in `spikes.md` spike 7: a fenced
` ```cairn-relation ``` ` block declaring the relation, one comparison function against
`package.json#files`, evaluated end to end (declare → red on real drift → green after fix)
with zero new sidecar namespace and zero new masking primitive (reuses `maskFencedCode`).
This is deliberately narrower than the full set of Must-tier cards above
(`solution-space.md` option C) — it proves ONE decidable predicate is buildable and
catches a real incident, which is the concrete evidence `roadmap.md`'s Release 1 needs to
not be speculative, the same role Release 1 plays in
`101-refs-symbol-scoping/roadmap.md`.
