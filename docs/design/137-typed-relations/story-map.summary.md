# Story map (issue #137) — summary

Opens with the required, verbatim-across-packages disclosure (short, framework-free — an
earlier draft using Team Topologies vocabulary was reverted on review as a poor fit for a
single-maintainer repo): every role is an internal engineering role (doc author, reviewer,
CI), not a customer persona. This package's own real cross-package relation lives in
[`../dependencies.md`](../dependencies.md), not here.

Backbone: write a claim → declare its relation → get evidence or admit there is none →
code changes → re-run check → read the report → fix or confirm.

Key stories: a claim needs an addressable object even with no natural link (#130); a
relation must say what kind of claim it is so cairn can pick an appropriate check; evidence
is mandatory so there's no unlabeled middle state; an author must not be able to satisfy
their own claim by quoting it in the annotation; a decidable failure and an undecidable
`open` status must read as visibly different report lines (#133); a vacuously-true
comparison must report as a guard failure, not a silent pass.

Each backbone step now carries exactly one `(Must)`-tagged card (enforced by
`checks.storyMapTiers`), all traceable back to spike 7's own end-to-end proof — which is
exactly why that proof is the walking skeleton.

**Walking skeleton:** `covers set:published-files`, exactly as built and proven in
`spikes.md` spike 7 — declare → red on real drift → green after fix, zero new sidecar,
zero new masking primitive.
