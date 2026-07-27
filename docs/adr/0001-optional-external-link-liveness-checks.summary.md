# Optional external link liveness checks — summary

`cairn check` never does network I/O today — external `http(s)` targets are explicitly
out of scope. This ADR adds an **opt-in** (`checks.externalLinks.enabled`, default
`false`) liveness check for external URLs, so the offline-by-default guarantee is
unaffected unless a repo turns it on.

Key decisions:

- **Scheduled via a sidecar**, not every run: a URL is only checked when **due**
  (`now >= nextCheckAt`), tracked per-URL (`lastCheckedAt`, `consecutiveFailures`,
  `nextCheckAt`) the same way the freshness-hash sidecar already tracks state outside
  the docs themselves. One run makes at most one attempt per due URL — no retry loop.
- **`interval` is a cron expression** (default `"0 0 * * 0"`, weekly), not a relative
  duration — calendar-aligned so a fleet of URLs converges onto shared check runs.
- **`intervalWhenStalled`** (default `"1d"`) is a plain duration that only pulls a
  failing URL's next check EARLIER than `interval`'s next occurrence, doubling per
  consecutive failure — fast enough to notice recovery, without hammering a dead domain.
- **A new warning class**, never folded into the existing `broken` reason set, and never
  fails `cairn check`'s exit code by default — liveness is flaky by nature, unlike a
  deterministic broken local path. An opt-in `--strict-external-links` flag exists for
  CI pipelines that want it to fail.

See the full ADR for considered alternatives (check-every-run, folding into `broken`,
fixed-interval retry) and consequences (`--prune` must learn about orphaned liveness
sidecars too).
