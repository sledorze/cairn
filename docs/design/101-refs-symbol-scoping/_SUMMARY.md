# Issue #101 design: `--refs` symbol/export-scoped hashing

Full design package for closing [issue #101](https://github.com/sledorze/cairn/issues/101)
("`--refs` whole-file granularity makes documentation drive code structure"), before any
implementation code is written. See
[`docs/adr/0004`](../../adr/0004-refs-scoped-hashing-granularity.md) for the accepted
decision this package supports.

- [Problem space](./problem-space.md) — the reported failure, root cause, and constraints
  any fix must satisfy.
- [Solution space](./solution-space.md) — five candidate directions, evaluated and ranked;
  one rejected.
- [Spikes](./spikes.md) — real feasibility evidence run against this repo's own toolchain,
  including a surprising finding about the pinned `typescript` version's API surface.
- [Story map](./story-map.md) — the doc author's real workflow, mapped to user stories and
  a walking-skeleton release.
- [Roadmap](./roadmap.md) — three independently-shippable releases, with migration notes.
- [Implementation details](./implementation-details.md) — concrete enough to start Release
  1 from directly; Release 2/3 sections are provisional.
- [Knowledge / skill](./knowledge.md) — the reusable technique this design surfaced, for
  whoever picks up the next release or the next issue like this one.
