# Roadmap: issue #137 (typed relations)

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

## Release 0 — the ROI checkpoint, not a code release

Before Release 1 starts: run the adversarial ROI attack this package's own scope
deliberately deferred (`problem-space.md`'s evidence-basis section, `AGENTS.md`'s
recurrence-gate lesson). Concretely: an independent reviewer (or a fresh sub-agent, per
this repo's own adversarial-review convention) attacks THIS design — cost of the Must tier
against a still-single-maintainer evidence base, cost of a new sidecar namespace and
annotation syntax, whether option (E) ("do nothing," `solution-space.md`) is actually the
right call once the concrete cost is in front of the reviewer instead of abstract. **A "no,
don't build this" verdict here is a legitimate, successful outcome of this whole design
package** — it is what the recurrence-gate/ROI-attack sequencing exists to allow, and
exactly what the `checks.claims` episode's own lesson calls for happening in the right
order this time.

## Release 1 — the Must tier: declare, validate, mandatory evidence, gap report

**Ships:** `solution-space.md` option C. A closed (small, initial) predicate registry; an
annotation syntax anchored in a fenced ` ```cairn-relation ``` ` block (spike 7's proven
shape — NOT an inline HTML comment, per spike 1/2's finding that comments are only
partially inert to existing checks); a `checks.relations` config surface, opt-in by
presence, following the `checks.freshness`/`checks.coverage` idiom
(`implementation-details.md`); validation that every declared relation's predicate is known
and its typed object resolves (a typo'd `set:` slug or unreadable `symbol:path#Name` is a
**relation error**, distinct from a false evaluation — see [`story-map.md`](./story-map.md),
whose walking-skeleton slice this release realizes); a report section
listing every `evidence: open` relation, visibly, as its own category.

**Ships alongside it: `covers set:published-files`** — the ONE Should-tier runner
[spike 7](./spikes.md) already built and proved, not held back for a later release, because without it Release 1
alone cannot catch the one fully-reproduced incident this whole package traces to (#130).
This mirrors `solution-space.md`'s synthesis directly: (C) and (B)'s object-addressing
share the same underlying mechanism, so shipping them together is not scope creep, it's the
minimum slice that's actually useful.

**Directly resolves:** #130, for the `covers set:` shape specifically. Makes #133
expressible in principle (a relation's predicate now carries a modality), though the report
grouping itself isn't built yet (Release 3).

**Does NOT yet resolve:** #101 (no `symbol:` object type yet — ADR 0004's own Releases 1–2
continue unaffected and unblocked by this release). Any predicate beyond `covers` remains
`evidence: open` even where a real check WOULD be possible.

**Migration:** `checks.relations` absent means zero behavior change — new config surface,
opt-in by presence, same as every other check added since `checks.freshness`.

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
