# Roadmap: issue #137 (typed relations)

**Status update, added after the fact — the Release 0 verdict below is kept UNCHANGED as
the historical record it explicitly says it is; this note sits above it, not inside it.**
Finding 4's "ADR 0004's own Release 1 (`refs.scope`) is ... still unbuilt in `src/`" was
true when that checkpoint ran. It no longer is: `refs.scope` shipped, followed by real
`--refs` enforcement, kind-aware stale-reference guidance, and a discoverability tip for it
— all real, merged, dogfooded. The opportunity-cost argument that finding made ("that should
ship first") is resolved, not open. Nothing else in this checkpoint's six findings depended
on that one being current, so the overall verdict (option B only, not the fuller vocabulary)
stands unchanged — only that one finding's premise did.

Four releases, each independently shippable and each independently valuable — not a
big-bang vocabulary rollout. Mirrors `101-refs-symbol-scoping/roadmap.md`'s own discipline:
a real repro, a real fix, a real before/after check, per release.

**Why this doesn't ship as one release, stated honestly:** unlike `101-refs-symbol-scoping/roadmap.md`'s
Release 1/2 split (there, Release 2's mechanism was already de-risked by spikes before the
roadmap was written, so the split is conservative sequencing, not a hard dependency), here
the split IS load-bearing: `solution-space.md`'s ranking specifically avoids committing to
generic Should-tier runners before real declared-but-`open` relations exist in this repo's
own docs to justify each one. Building runners speculatively ahead of real `open` relations
would repeat exactly the mistake the killed `checks.claims` episode is presumed to have made
(`problem-space.md`'s evidence-basis section) — design ahead of concrete, dogfooded need.

## Release 0 — the ROI checkpoint, run for real, verdict recorded here

Before Release 1 was allowed to start, the adversarial ROI attack this package's own scope
deliberately deferred (`problem-space.md`'s evidence-basis section, `AGENTS.md`'s
recurrence-gate lesson) was actually run — an independent reviewer (a fresh sub-agent, per
this repo's own adversarial-review convention), given this package's own honest claims
about itself, not a summary written by whoever wrote the design.

**Verdict: do not build Release 1 as originally scoped below.** Six findings, in brief
(full reasoning is this checkpoint's own record, not restated in full here since it isn't a
separate required doc in this package's shape):

1. The evidence base (one maintainer, zero outside corroboration on #137/#130/#133) doesn't
   support the investment size (a new predicate vocabulary, annotation syntax, config
   surface, and two new module trees) when option (B) alone closes the one fully-reproduced
   incident at a fraction of the cost.
2. The recurrence-gate evidence (`falsestart/documented.test.ts`'s 12 checkers) is from a
   DIFFERENT repo — nothing has recurred a second time inside cairn's own operation since
   #130 was fixed by hand.
3. A closed predicate registry is an anti-escape-hatch defense against many contributors
   gaming config; cairn has one maintainer, who would bear its entire ongoing cost alone.
4. Real opportunity cost: ADR 0004's own Release 1 (`refs.scope`) is already accepted,
   spiked, cheaper, and — grepped, not assumed — still unbuilt in `src/`. That should ship
   first regardless of this design's fate.
5. A genuinely cheaper alternative ("don't write unverifiable prose claims") was folded
   into option (E) without a fair standalone hearing.
6. Process signal: two full design efforts (`checks.claims`, then this package) have now
   landed on "don't build the big version" after large writing investment — worth naming
   for next time, independent of this design's specific merits.

**A "no, don't build this [as scoped]" verdict is exactly the legitimate, successful
outcome this checkpoint exists to allow** — the recurrence-gate/ROI-attack sequencing
worked as intended. Releases 1–4 below are kept, UNCHANGED, as the record of what was
considered and rejected at this scope — per this repo's own convention of recording a
rejected option rather than silently deleting it (`solution-space.md`'s own "rejects
recorded, not silently dropped"). **What actually ships is the narrower slice below.**

## Release 1 (accepted, replaces the Must-tier below) — `solution-space.md` option B only

**Ships:** declared extra `--refs` targets, no predicate vocabulary, no typed-object
grammar beyond a bare path list, no `checks.relations` config surface, no `core/relations/`/
`program/relations/` module trees, no hazard-guard architecture. Concretely, verified
against the real `src/program/links/CheckRefs.ts`/`RefStore.ts`:

- One new extraction function, `declaredExtraTargets(content): string[]`, reading a bare
  target list out of a fenced ` ```cairn-refs ``` ` block — reusing spike 7's proven
  masking discovery (an unrecognized fenced info string is already invisible to every
  existing check) but with a MUCH smaller grammar than the rejected Release 1's relation
  syntax: no predicate, no typed object, no evidence field, just paths.
- One call-site change, in `stampRefs` only (`CheckRefs.ts`): union
  `declaredExtraTargets(content)` with `extractReferences(content)`'s targets before the
  existing per-doc loop, so a declared target flows through the SAME
  `resolveReferenceContent` → `hashContent` → `toRecord` → sidecar-write path a real link's
  target already uses.
- **`checkRefs` needs zero changes.** It never re-parses the doc — it replays whatever
  `stampRefs` already wrote to `.cairn/refs/**`, so once a declared target is in the
  sidecar, drift detection and `formatRefsReport` already work on it generically.
- No new sidecar namespace (`RefStore.ts` unchanged).

**Directly resolves:** #130, for the exact incident shape spike 7 reproduced (a claim about
`package.json#files` with no link) — verified end to end before this narrowing (spike 7),
unaffected by it since the comparison logic isn't part of what's being cut.

**Does NOT resolve:** #101 (unaffected either way — stays on ADR 0004's own path, which
should ship FIRST, per finding 4 above) or #133 (stays open; `solution-space.md` option E's
doc-vs-source labeling remains its own cheapest standalone fix if it's ever prioritized).

**Migration:** no new config surface required for this slice — a doc simply gets to name
more `--refs` targets. Zero behavior change for a doc that declares none.

<details>
<summary>Rejected: the original, larger Release 1 (the Must tier + `covers`)</summary>

**Would have shipped:** `solution-space.md` option C. A closed (small, initial) predicate
registry; an annotation syntax anchored in a fenced ` ```cairn-relation ``` ` block (spike
7's proven shape — NOT an inline HTML comment, per spike 1/2's finding that comments are
only partially inert to existing checks); a `checks.relations` config surface, opt-in by
presence, following the `checks.freshness`/`checks.coverage` idiom
(`implementation-details.md`); validation that every declared relation's predicate is known
and its typed object resolves (a typo'd `set:` slug or unreadable `symbol:path#Name` is a
**relation error**, distinct from a false evaluation — see [`story-map.md`](./story-map.md));
a report section listing every `evidence: open` relation, visibly, as its own category —
plus `covers set:published-files` shipped alongside it ([spike 7](./spikes.md)), since Must
alone couldn't catch #130 without at least one runner.

**Why rejected:** the Release 0 verdict above. Kept here, not deleted, as the record of
what a fuller design would have looked like and why it wasn't worth it at this evidence
level.

</details>

**Trigger to revisit the rejected, fuller design:** a SECOND, independently-shaped incident
recurring inside cairn's OWN repo (not `falsestart`) that option (B)'s extra-target
mechanism genuinely cannot express — a real case observed in practice where the missing
piece isn't "an unlinked target changed" but requires an actual predicate (a negative
claim, a count, a grammar match) to catch. Not a fixed date, not "if it becomes more
important" — a concrete, observed second recurrence.

## Releases 2–4 — on hold, gated on the same trigger as the rejected fuller Release 1

Each of Releases 2–4 below builds directly on the rejected predicate-vocabulary
architecture (Release 2's `symbol:` object extends the typed-object grammar; Release 3's
modality grouping needs real relations with real predicates to group; Release 4 is
explicitly "the next Should-tier runner"). None of them ships independently of that
architecture existing, so all three are on hold behind the SAME trigger named above, not
individually re-evaluated. Kept below, unchanged, as the record of what each would look
like if the trigger fires.

## Release 2 — `symbol:path#Name` objects, absorbing ADR 0004's Release 3

**Ships:** the `symbol:` typed-object variant, resolved via the SAME
`typescript/unstable/ast` scanner primitive `101-refs-symbol-scoping/spikes.md` spike 4
already validated standalone — no new parser dependency beyond what ADR 0004 Release 2
already commits to. A relation whose object is `symbol:src/checking/engine.ts#checkFile`
resolves to that one declaration's byte range, the same primitive `--refs`'s own future
Release 3 would have used.

**Directly resolves:** #101, reframed — a doc's citation now SAYS "this claim is about one
symbol" (`symbol:`) vs. "this claim is about the whole file's public surface" (`file:`,
narrowed by ADR 0004 Release 2's export-surface hashing) vs. "this claim is about the whole
file" (`file:`, Release 1's default) — the granularity question ADR 0004 already answers
for `--refs`-style citations becomes one instance of typed-object resolution here, not a
second, separately-maintained mechanism. Per `solution-space.md`'s "relationship to ADR
0004" section: this release supersedes ADR 0004's own Release 3 specifically (not
Releases 1–2), and should be recorded as such — an ADR amendment, not a silent
replacement — once this release actually ships.

**Hard requirement before this ships, carried over unchanged from `101-refs-symbol-scoping/roadmap.md`:**
rename resilience. A `symbol:` object whose named declaration no longer exists must be a
distinct, actionable relation error ("target symbol `checkFile` no longer exists in
`engine.ts`"), never a silent vacuous pass — spike 8's guard discipline, applied to object
resolution itself, not only to comparison predicates.

**Trigger for starting this release:** the SAME trigger `101-refs-symbol-scoping/roadmap.md`
already states for its own Release 3 — real usage data showing `file:`/export-surface
granularity is still too coarse for a real declared relation, not a fixed date.

## Release 3 — modality-grouped reporting, closing #133

**Ships:** report output grouped by the predicate's derived modality — decidable relations
that FAILED (needs a fix), decidable relations that PASSED (silent, or a summary count),
refutable-only relations sampled this run, undecidable relations still `open` or
`declined`. Strictly supersedes #133's own narrower proposed fix (doc-vs-source labeling)
per `solution-space.md`'s synthesis — the classification is available for every relation,
not only ones with a link to a source file.

**Directly resolves:** #133.

**Depends on:** Release 1 existing (there must be real relations with real modalities to
group) but not on Release 2 — this release can ship as soon as Release 1 has produced
enough real report volume to be worth grouping, independent of whether `symbol:` objects
exist yet.

## Release 4 (optional, explicitly speculative) — one additional decidable predicate per real need

**Ships:** the NEXT Should-tier runner (`enumerates`, `confinedTo`, `counts`, or
`parsesAs`), chosen by which `evidence: open` relation actually accumulates in this repo's
own dogfooded docs — not pre-selected here. Each addition follows spike 7/8's proven
pattern: a real annotation, a real comparison function, the vacuity guard applied, a real
before/after proof.

**Explicitly not committed to a fixed set or a fixed order** — `solution-space.md`'s
synthesis names this as the incremental tail, gated on real declared-but-unchecked need
surfacing in practice, the same discipline that makes Release 0's ROI checkpoint meaningful
rather than a one-time gate that's never revisited.

## Explicitly out of scope for all releases here

- The Could-tier "review prompt generated from a relation" (issue's own MoSCoW) — the issue
  itself defers this explicitly ("only as good as the vocabulary beneath it"); nothing in
  this roadmap changes that.
- Adjudicating undecidable relations (`implementedBy`, `explains`, `matchesRuntime`) — Won't,
  per the issue; these stay `open`/routed to a human indefinitely, by design, not as a gap.
- Executing arbitrary project code as part of evidence resolution — Won't, per the issue;
  every generic runner built here operates on already-available doc/config/`package.json`-
  shaped data, never a shell-out to project-defined code.
