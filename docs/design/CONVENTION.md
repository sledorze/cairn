# The design-package convention (and how it's structurally enforced)

## Why this exists

A design package (`docs/design/<slug>/`) is deliberately **plain Markdown prose**, not a
generated artifact — the reasoning, evidence, and tradeoffs it records need a human (or an
agent) to actually think and write, not fill in a template mechanically. But prose alone
has no way to guarantee a package is actually COMPLETE: nothing stops an author from
skipping the spikes, or writing a roadmap with no evidence behind it, and nothing would
notice. The fix isn't a new file-generation mechanism — it's making the EXISTING
`checks.coverage` feature (kinds/rules — see the README, `docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`) enforce the
package's required shape, the same way it already enforces any other doc→doc obligation.

**This is dogfooding a real question from this repo's own usage of cairn**: "are these
design-doc files just informal convention, or something cairn's own config can hold to a
required shape?" The answer, materialized here rather than left as an aspiration: **the
existing `kinds`/`rules` mechanism already does this — no new config primitive was needed.**

## The convention

A design package is a directory `docs/design/<slug>/` containing:

- `_SUMMARY.md` — the package's own index, linking every child doc below.
- `problem-space.md` — the failure/gap, root cause, constraints on any fix.
- `solution-space.md` — candidate directions, evaluated and ranked; rejects recorded, not
  silently dropped.
- `spikes.md` — feasibility evidence actually RUN, not assumed.
- `story-map.md` — the real user workflow, mapped to stories and a walking-skeleton slice.
- `roadmap.md` — shippable increments, with migration notes.
- `implementation-details.md` — concrete enough to start from.
- `knowledge.md` — the reusable technique, for whoever extends this later.

Any consumer of `cairn` can adopt this exact shape for their own design work by copying the
`checks.coverage` block below into their own `.cairnrc.json` — nothing here is specific to
cairn's own repo beyond the `docs/design/` path, which is itself just a convention, not a
hardcoded assumption.

## The config that enforces it (copy this into your own `.cairnrc.json`)

```json
"checks": {
  "coverage": {
    "kinds": [
      { "id": "design-package", "select": { "by": "path", "glob": "**/docs/design/*/_SUMMARY.md" } },
      { "id": "problem-space", "select": { "by": "path", "glob": "**/docs/design/*/problem-space.md" } },
      { "id": "solution-space", "select": { "by": "path", "glob": "**/docs/design/*/solution-space.md" } },
      { "id": "spikes", "select": { "by": "path", "glob": "**/docs/design/*/spikes.md" } },
      { "id": "story-map", "select": { "by": "path", "glob": "**/docs/design/*/story-map.md" } },
      { "id": "roadmap", "select": { "by": "path", "glob": "**/docs/design/*/roadmap.md" } },
      { "id": "implementation-details", "select": { "by": "path", "glob": "**/docs/design/*/implementation-details.md" } },
      { "id": "knowledge", "select": { "by": "path", "glob": "**/docs/design/*/knowledge.md" } }
    ],
    "rules": [
      { "from": "design-package", "to": "problem-space" },
      { "from": "design-package", "to": "solution-space" },
      { "from": "design-package", "to": "spikes" },
      { "from": "design-package", "to": "story-map" },
      { "from": "design-package", "to": "roadmap" },
      { "from": "design-package", "to": "implementation-details" },
      { "from": "design-package", "to": "knowledge" }
    ]
  }
}
```

**Deliberately kind-based, not filename-based**: a rule is satisfied by ANY doc matching
the `to` kind's glob, so an author is free to name their own files however they like (this
repo's own `problem-space.md`/`solution-space.md`/... naming is one convention, not a
requirement `checks.coverage` itself imposes) as long as each required ROLE has some doc
filling it, linked from the package's own summary. This is what makes the mechanism
generalize to a different consumer's naming preferences, rather than being tied to this
repo's specific filenames.

## Materialized and falsified for real, not just designed on paper

Enabled in this repo's own `.cairnrc.json` (dogfooding), then verified against the real
`docs/design/101-refs-symbol-scoping/` package: `cairn check` passes cleanly today (every
required kind present and linked). Falsified by removing the `spikes.md` link from that
package's `_SUMMARY.md` — `cairn check` immediately reported it three independent ways at
once: `checks.coverage`'s own `missing coverage` (`no link to a "spikes"-kind doc`),
`checks.coverage`'s `orphan` detection (`spikes.md` now has zero inbound references), AND
the pre-existing summary link-completeness check (`missing child links`). Restoring the
link returned to green. All three signals converging on the same real gap is a genuinely
strong result — not one narrow check, but the intersection of three already-independently-
useful ones.

## A real, honest limitation — found by adversarial stress-testing, not glossed over

`checks.coverage`'s rules are NOT scoped per-package: a rule `{from: design-package, to:
spikes}` is satisfied by a link to ANY doc of kind `spikes` ANYWHERE in the scanned corpus,
not specifically THIS package's own `spikes.md`. Verified concretely: a throwaway second
package (`docs/design/999-fake-test-package/`, since deleted) whose `_SUMMARY.md` linked
entirely to the FIRST package's docs — none of its own — passed `checks.coverage` cleanly
(`✅ Coverage OK (9 doc(s) checked)`). A careless or lazy author could satisfy the
structural check by cross-linking a sibling package's docs instead of writing their own.

This is a genuine gap in what `checks.coverage`'s existing `kinds`/`rules` shape can
express — it has no notion of "the same containing directory" as a scoping constraint, only
"anywhere in the corpus." Closing it would need either a NEW selector variant (e.g.
`by: 'path'` gaining a "same parent directory as the FROM doc" relation) or a dedicated new
check — genuinely out of scope for this convention doc to design speculatively. Recorded
here as a known, load-bearing limitation of reusing `checks.coverage` for this purpose, not
silently left for a future reader to rediscover the hard way. In practice, with one design
package today, this doesn't bite — but it would need addressing before this convention is
recommended at scale (many concurrent design packages).
