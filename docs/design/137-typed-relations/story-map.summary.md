# Story map (issue #137) — summary

Backbone: write a claim → declare its relation → get evidence or admit there is none →
code changes → re-run check → read the report → fix or confirm. Personas are internal
engineering roles throughout (doc author, contributor, maintainer), stated rather than
invented, matching `CONVENTION.md`'s own discipline for this repo's design packages.

Key stories: a claim needs an addressable object even with no natural link (#130); a
relation must say what kind of claim it is so cairn can pick an appropriate check; evidence
is mandatory so there's no unlabeled middle state; an author must not be able to satisfy
their own claim by quoting it in the annotation; a decidable failure and an undecidable
`open` status must read as visibly different report lines (#133); a vacuously-true
comparison must report as a guard failure, not a silent pass.

**Walking skeleton:** `covers set:published-files`, exactly as built and proven in
`spikes.md` spike 7 — declare → red on real drift → green after fix, zero new sidecar,
zero new masking primitive.
