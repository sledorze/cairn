# Issue #151 design: root-level docs reachable by cairn

Full design package for closing [issue #151](https://github.com/sledorze/cairn/issues/151)
("Root-level docs (AGENTS.md, README.md) can't be checked by cairn itself — only by bespoke
tests"), before any implementation code is written.

- [Problem space](./problem-space.md) — `isDir` (`src/config.ts`) drops any file-shaped
  `roots` entry, so `AGENTS.md`/`README.md`/`CLAUDE.md` are invisible to cairn's own
  engine; two independent, merged tests hand-roll narrow content-coverage checks to
  compensate — the actual anti-pattern this design exists to end.
- [Solution space](./solution-space.md) — four candidates: a literal-file-roots primitive
  (recommended), an `ignore`-pattern shallow scan (rejected, disproven live), status quo
  bespoke tests (rejected as the durable answer), and two separate `cairn check`
  invocations (the shape the recommended primitive ships in).
- [Spikes](./spikes.md) — real evidence run against the real built CLI: confirms today's
  failure, confirms option 2's rejection with a real broken-link repro, and traces the
  actual size of option 1's code change (small, not a deep refactor).
- [Story map](./story-map.md) — a maintainer's real workflow editing a root-level doc,
  mapped to stories and a walking-skeleton release.
- [Roadmap](./roadmap.md) — one release: the literal-file-roots primitive, consumed via a
  second `--links-only` invocation; an explicit decision that summaries/coverage do NOT
  extend to file-roots yet; a migration note to close/supersede PR #148 once this ships.
- [Implementation details](./implementation-details.md) — concrete diff shape for
  `src/config.ts`'s `expandOne` and `src/io/DocsFs.ts`'s `listFiles`, plus why `checkLinks`
  and the in-memory test double need no changes at all.
- [Knowledge / skill](./knowledge.md) — the reusable lesson: a scanning-exclusion
  mechanism and an existence universe are different concerns even when they share one
  config key, and why this design ran its two most load-bearing claims for real instead of
  trusting a static code read.
