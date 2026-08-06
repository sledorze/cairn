# Issue #137 design: typed relations

Full design package for [issue #137](https://github.com/sledorze/cairn/issues/137)
("Typed relations: a link records an address, not an assertion — so cairn can only say 'it
changed'"), before any implementation code is written. Proposes reframing #101, #130, and
#133 as three faces of one root cause: cairn's link/`--refs` model can detect that a cited
target changed, but has no field for what a doc actually _claims_ about it, so it can never
say a claim is right or wrong — only different. See
[`solution-space.md`](./solution-space.md) for how this relates to the already-accepted
[`docs/adr/0004`](../../adr/0004-refs-scoped-hashing-granularity.md) (#101's own decision).

- [Problem space](./problem-space.md) — the missing field, three real incidents traced to
  it, and every constraint the issue names re-verified against current `src/` (two held,
  one held partially, one did not reproduce).
- [Solution space](./solution-space.md) — five candidate directions, evaluated and ranked;
  the relationship to ADR 0004 stated explicitly.
- [Spikes](./spikes.md) — eight probes against this repo's own source and toolchain (six
  run as real scripts/CLI commands, two settled by direct source reading where no code
  needed to run), including a working end-to-end walking skeleton that catches the actual
  #130 incident shape, red then green.
- [Story map](./story-map.md) — the doc author's real workflow, mapped to stories and the
  walking-skeleton slice.
- [Roadmap](./roadmap.md) — five releases (an explicit ROI checkpoint first, then four
  shippable increments), with migration notes.
- [Implementation details](./implementation-details.md) — concrete enough to start Release
  1 from directly; later releases are provisional.
- [Knowledge / skill](./knowledge.md) — the reusable technique this design surfaced,
  including two hazards (self-refutation, vacuity) proven in code, not just narrated.
