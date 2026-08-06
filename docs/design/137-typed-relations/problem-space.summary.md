# Problem space (issue #137) — summary

Every cairn check today measures address + hash: does a link resolve, has its target
changed since stamped. None carries what a doc's prose actually _claims_ about that
target — so cairn can say "it changed," never "it's now wrong."

**Three real incidents, one root cause:** #101 (whole-file granularity — the address is
too coarse for the actual claim), #130 (a claim with no link at all drifts silently — no
address exists), #133 (source-drift and doc-drift arrive undifferentiated — no way to ask
which report lines are self-checking).

**Evidence basis, stated honestly:** one maintainer's own dogfooding across two side
projects, zero outside corroboration on any of #137/#130/#133. What's new versus a first
report: this exact territory (`checks.claims`) was designed once already and killed by an
ROI attack, per `AGENTS.md`'s own recorded lesson — provenance traces it to the same #130
incident. #137 clears the recurrence gate (twelve independently-added checkers in
`falsestart`'s `documented.test.ts`); it does not by itself clear an ROI bar, which is why
this package's job is producing a design an ROI attack can be run against, not
presupposing the answer.

**Root cause:** a link is a relation with an implicit, unstated predicate — making the
predicate explicit is what turns "it changed" into something that can be right or wrong.

**Constraints, re-verified against current `src/` (not just the issue's cited `dist`):**
two of the issue's four masking/asymmetry claims held (HTML comments are live to links;
the `#`-anchor asymmetry is real and its exact mechanism is `CheckProseRefs.ts` never
calling `stripAnchor`); one held only partially (`--prose-refs` DOES see a backticked
path inside a comment, just not a bare one); one did not reproduce at all (no Prettier
blank-line insertion, under this repo's real config/version). New constraint found here:
`parseFrontmatter` is genuinely flat — no lists/nesting — so a frontmatter-anchored
relation isn't free.

**Two hazards reproduced in real code, not narrated:** an annotation quoting its own
forbidden text flips a `neverClaims` check false; an annotation naming its own object
silently satisfies a `covers` check (the more dangerous, silent-green direction). Both
close via slug-referenced propositions plus one shared annotation-stripping helper. A
naive vacuity trap is narrower than the issue implies: full-equality set comparisons are
already safe; only subset-only comparisons need an explicit non-empty guard.
