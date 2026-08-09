# Knowledge / skill (issue #137) — summary

**The self-refutation hazard is structural, not a checklist item.** Every future relation
runner must be built on the shared extraction path (never able to see its own annotation),
not rely on each author remembering to strip it — spike 4 proved both a loud failure mode
(quoting a forbidden proposition flips a claim false) and a silent, more dangerous one
(naming an object inline satisfies the claim it labels).

**The vacuity guard is narrower than the issue's own framing.** Check which comparison
shape a new predicate actually uses before adding defensive code: full-equality
comparisons are already safe via their own size check; only subset-only comparisons need
an explicit non-empty guard.

**Validate every claim against current code, don't inherit a prior characterization.** Two
of the issue's four stated constraints didn't hold as written when re-run against current
`src/` — re-verify masking/extraction behavior directly, don't trust even a careful prior
description.

**Reproduce an incident's real shape even if the exact artifact is gone.** #130's original
`README.summary.md` sentence no longer exists in this repo; spike 7 reconstructs the same
structure in a disposable `makeTempProject` instead of skipping the spike or inventing a
historical file.

**State a new design's relationship to an already-accepted adjacent decision explicitly.**
`solution-space.md` names exactly which part of ADR 0004 this design absorbs (Release 3
only) rather than leaving the overlap for an implementer to reverse-engineer.

**Sequence the riskiest, least-grounded piece last, gated on real accumulated need** —
this repo just watched a two-turns-of-design effort (`checks.claims`) get killed by
premature investment; Release 0's explicit ROI checkpoint is this design's answer.
