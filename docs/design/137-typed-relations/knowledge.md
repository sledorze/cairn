# Knowledge / skill: typed relations (issue #137)

A distilled how-to for whoever (human or agent) picks up Release 1+ from `roadmap.md` — the
reusable technique this design surfaced, not a restatement of the other docs. Read
`problem-space.md` → `solution-space.md` first for WHY; this doc is HOW to keep extending
it correctly, and HOW to recognize the specific failure class this design exists to
prevent. Every lesson below restates a finding actually produced by running
[`spikes.md`](./spikes.md), not general advice.

## The one invariant every predicate must preserve: the self-refutation hazard is structural, not a checklist item

Every generic relation runner added after Release 1 (`roadmap.md`'s Release 4 tail) must be
built so its evaluation **cannot see its own annotation** — not "the author remembered to
strip it," a property of one runner, but a property of the shared extraction path itself
(`extractRelations`, built on `maskFencedCode`). Spike 4 proved both directions of this
failure with real code, not narration: a `neverClaims`-shaped check that quotes its own
forbidden text at the claim site flips itself false (loud, annoying, but SAFE — a false
negative on a true claim gets noticed); a `covers`-shaped check that names its own object
inline satisfies itself silently (fails GREEN — the dangerous direction, because nothing
prompts a reader to go looking). **Any new predicate's design review must specifically ask:
"if this predicate's object or expected value were quoted verbatim inside the relation's
own annotation, would the checker's read of doc content include that quote?"** — if yes,
the checker isn't reading through the shared masking path and needs to be fixed before it
ships, not after a real incident surfaces the gap the way #130 did.

## The vacuity guard is narrower than it first looks — verify the actual comparison shape, not just the concept

Spike 8 set out to reproduce a claimed general failure ("set comparisons vacuously pass on
empty input") and found something more precise: a FULL equality comparison (size check +
membership) is already safe — an empty found-set correctly fails the size check. The actual
trap is specifically a SUBSET-ONLY comparison with no separate size check
(`found.every(item => want.has(item))`), because `[].every(...)` is vacuously `true` in
JavaScript regardless of the predicate. **Before assuming a new comparison needs an
explicit vacuity guard, check which shape it actually is** — a full-equality comparison
gets the guard "for free" from its own size check; a subset/superset/containment-only
comparison does not and needs the guard added explicitly. Treating every comparison as
equally at risk (the issue's own framing) would mean adding defensive code to shapes that
don't need it, which is itself a cost — precision here saves real implementation effort,
not just correctness.

## How to validate a claim in this design before trusting it

Every numbered constraint in `problem-space.md`'s "constraints on any solution" section was
independently re-verified against current `src/`, not carried over from the issue
unchanged — and two of the issue's own four claims did NOT hold as originally stated
(spike 2: `--prose-refs` partially sees inside comments; spike 6: no Prettier blank-line
insertion reproduced). This is the load-bearing habit, not a one-time diligence pass:

1. **Re-run every masking/extraction claim against the CURRENT `src/` before reusing it** —
   `stripCode`, `extractProseRefs`, `parseFrontmatter` are all real, small, readable
   functions; read them directly rather than trusting a prior design doc's (or an external
   issue's) characterization of what they do, even one written carefully.
2. **A spike that falsifies the issue's own premise is a BETTER outcome than one that
   confirms it** — spike 6 (no Prettier hazard reproduced) removed a constraint from this
   design's real cost, not just from its risk register. Don't let "the issue said X" stand
   in for "X is still true here, now."
3. **Grep the actual current plugin/config wiring before describing it as absent or
   present** — `101-refs-symbol-scoping/knowledge.md` records a real instance of this design
   package's own sibling getting `CheckRefs.ts`'s plugin status wrong on first draft; the
   same discipline applies here to `CheckPlugin.ts`'s registry and `Config.ts`'s
   `resolveLayer` branches, which change over time.
4. **When a scratch spike takes a shortcut a real implementation must NOT take** (spike 7's
   regex-based `package.json` parse instead of `Schema.decodeUnknownEffect`, taken because
   scratch code under `.scratch/` is exempt from this repo's `no-json-global` lint rule),
   **say so explicitly in the spike itself**, not just in `implementation-details.md` —
   otherwise a future reader copying the spike's code into `src/` inherits the shortcut
   silently.

## The pattern this design followed, worth reusing for the next issue like this

1. **Reproduce the incident's actual shape before designing its fix**, even when the exact
   artifact no longer exists. `README.summary.md`'s tarball sentence (#130's real trigger)
   isn't in this repo's docs anymore — spike 7 reconstructs the same STRUCTURE (a claimed
   set vs. `package.json#files`, no link) in a disposable temp project instead of either
   skipping the spike or fabricating a fake historical file. `makeTempProject`
   (`src/testSupport/tempProject.ts`) is the right tool for this precisely because it models
   BEFORE/AFTER drift on real disk, per its own header comment — reuse it, don't reinvent a
   fixture mechanism.
2. **When a killed prior design (`checks.claims`) left no artifact, don't re-derive its
   reasoning from scratch — reconstruct provenance first.** `git log -S "<term>"` plus
   reading the one surviving mention (`AGENTS.md`'s recurrence-gate lesson) established
   which incident killed it and why, in minutes, rather than re-litigating an ROI question
   this design package deliberately defers to a separate step (`roadmap.md`'s Release 0).
3. **State explicitly how this design relates to an ALREADY-ACCEPTED, adjacent decision**
   (ADR 0004) rather than silently overlapping or silently ignoring it —
   `solution-space.md`'s dedicated "relationship to ADR 0004" section names exactly which
   part is absorbed (Release 3) and which is untouched (Releases 1–2), so a future
   implementer doesn't have to reverse-engineer whether the two designs conflict.
4. **Sequence releases so the riskiest, least-grounded piece (generic Should-tier runners)
   ships LAST, gated on real accumulated `open` relations** — not because incremental
   delivery is a virtue in the abstract, but because this specific repo just watched a
   two-turns-of-design effort get killed by exactly this kind of premature investment
   (`problem-space.md`'s evidence-basis section). The roadmap's own Release 0 (an explicit
   ROI checkpoint before any code ships) is this design's answer to not repeating that.

## Where this connects to the rest of the codebase (for `checks.docCoverage` accuracy)

This design's own source files (once Release 1+ ship as real code, under `core/relations/`
and `program/relations/`) will need citing from `docs/architecture.md`, the same way
`core/structure/CheckCoverage.ts`/`DocCoverage.ts` already are — do not let this become the
next bare mention this design's own `problem-space.md` describes as invisible to every
existing check.
