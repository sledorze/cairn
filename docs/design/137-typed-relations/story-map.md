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

### 2. Declare its relation

- _As a doc author, I want to say what KIND of claim this is_ (enumerates a set / never
  contains a string / a command's output matches a fixture) so cairn can pick an
  appropriate check instead of treating every claim the same generic way. _(Must)_
- _As a doc author, I want to address the claim's object precisely_ — a whole file, one
  named symbol, a computed set, a command's output — without being forced to invent a fake
  link just to have somewhere to point. _(Must — directly resolves #130's "a relation needs
  no link.")_
- _As a doc author, I must not be able to skip saying whether this claim is even checkable_
  — evidence is mandatory, with `open`/`declined "<reason>"` as honest escape hatches, so
  there's no unlabeled middle state. _(Must)_

### 3. Get evidence, or admit there is none

- _As a doc author, if my claim's predicate is one cairn can check generically, I want it
  checked automatically_ — no hand-written test file per claim, unlike today's
  `documented.test.ts` pattern this design generalizes from. _(Should, one predicate at a
  time — see `roadmap.md`.)_
- _As a doc author whose claim's predicate has no generic checker yet, I want that fact to
  be VISIBLE_ — a list of `open` relations, not silence. _(Could, "gap reporting.")_
- _As a doc author, I must not be able to satisfy my own claim by writing an annotation
  that names or quotes the very thing being claimed_ — the self-refutation hazard
  (`problem-space.md`, spike 4) must be structurally impossible, not just documented as a
  pitfall to avoid by hand.

### 4. Code changes

- _As a contributor, editing `package.json#files` should make a doc's `covers
set:published-files` relation fail if the doc wasn't updated_ — the exact #130 incident,
  reproduced and proven catchable in `spikes.md` spike 7.
- _As a contributor, editing an unrelated part of a file a relation's object resolves
  against should NOT fail the relation_ — the same non-vacuous, precision-preserving
  requirement `101-refs-symbol-scoping/story-map.md` already states for `--refs`; typed
  relations must not regress it by being coarser than the existing mechanism where they
  overlap.

### 5. Re-run `cairn check`

- Non-negotiable engineering constraint, kept outside persona format for the same reason
  `101-refs-symbol-scoping/story-map.md` does: a relation's evaluation must never read its
  own annotation as part of the doc content it's evaluating — the single
  annotation-stripping helper (`problem-space.md`) is structural, not best-effort.
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
- _As a doc author, a vacuously-true comparison (a renamed heading, an empty set on both
  sides) must be reported as a GUARD FAILURE, not silently pass_ — spike 8's finding,
  applied.

### 7. Fix the doc, or confirm it still holds

- _As a doc author, fixing a relation's failure and re-running should go green for a
  verifiable, specific reason_ — proven end to end in spike 7 (BEFORE agree → AFTER drift,
  red, exact missing item named → fixed, green).
- _As a maintainer, re-declaring a relation's evidence as `declined "<reason>"` should be a
  deliberate, reviewable act_ (it appears in the report, same as an `open` relation would),
  not a silent downgrade — mirrors this repo's own `checks.proseRefs.ignore` discipline
  (an exemption is declared, not invisible).

## Walking skeleton (the line above marks it in each column)

`covers set:published-files`, exactly as built in `spikes.md` spike 7: a fenced
` ```cairn-relation ``` ` block declaring the relation, one comparison function against
`package.json#files`, evaluated end to end (declare → red on real drift → green after fix)
with zero new sidecar namespace and zero new masking primitive (reuses `maskFencedCode`).
This is deliberately narrower than the full Must tier (`solution-space.md` option C) — it
proves ONE decidable predicate is buildable and catches a real incident, which is the
concrete evidence `roadmap.md`'s Release 1 needs to not be speculative, the same role
Release 1 plays in `101-refs-symbol-scoping/roadmap.md`.
