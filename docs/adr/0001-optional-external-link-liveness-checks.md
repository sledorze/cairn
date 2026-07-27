---
status: proposed
---

# Optional external link liveness checks, scheduled and non-blocking by default

## Context

`cairn check` only ever validates what's decidable from the repo's own content —
local paths, same-page anchors, line fragments. External `http(s)` URLs are
explicitly out of scope (`isCheckableTarget` skips anything with a URL scheme):
no network I/O, ever, in the default path. That's deliberate — `cairn check` is
meant to be fast, offline, and deterministic, a property several existing ADR-
worthy decisions in this codebase protect (the whole hidden `.cairn/` sidecar
design exists specifically so summary freshness survives a fresh `git clone`
with zero network dependency).

External links do rot, though — a URL that resolved when a doc was written can
404 or the domain can lapse months later, and nothing in `cairn check` today
would ever notice. Users have asked for a way to catch that.

## Decision

Add an **opt-in**, separately-scheduled liveness check for external links,
off by default:

```json
"checks": {
  "externalLinks": {
    "enabled": false,
    "interval": "0 0 * * 0",
    "intervalWhenStalled": "1d"
  }
}
```

- **Opt-in, not a new default.** `enabled: false` unless a repo explicitly turns
  it on — the offline-by-default guarantee for everyone who hasn't asked for
  this stays intact.
- **Scheduled via a sidecar, not every run.** A URL is only network-checked when
  it's **due** (`now >= nextCheckAt`), tracked in a `.cairn/`-sidecar-shaped
  liveness record per URL (`lastCheckedAt`, `consecutiveFailures`,
  `nextCheckAt`) — the same "state lives outside the docs you write" discipline
  the freshness-hash sidecar already established. **One run makes at most one
  attempt per due URL** — no in-run retry loop.
- **`interval` is a cron expression, not a duration.** A healthy URL is
  re-checked on `interval`'s next calendar occurrence (default `"0 0 * * 0"`,
  weekly) rather than "N days since last check" — calendar-aligned, so a
  fleet of URLs checked together converges onto the same run instead of
  drifting apart by whenever each first became due. `intervalWhenStalled`
  stays a plain duration (default `1d`): once a URL is **stalled** (its last
  check failed), it doubles on each consecutive failure and can only pull the
  next check EARLIER than `interval`'s next calendar occurrence, never later
  — tight enough to notice a real recovery reasonably soon, without turning a
  genuinely dead domain into a repeated-hammering target.
- **A new warning class, not folded into `broken`.** An unresponsive URL is
  reported separately from a broken link (see `CONTEXT.md`'s **Broken link**
  vs **Unresponsive link**) and does **not** fail `cairn check`'s exit code by
  default — liveness is inherently flaky (a transient outage looks identical
  to a real 404), unlike a broken local path, which is deterministic the
  moment it's checked. A `--strict-external-links` flag can opt a CI pipeline
  into failing on it, for repos that want that.

## Considered Options

- **Check every external URL on every run.** Rejected: turns every `cairn
check` into a network-bound, flaky operation by default, for every existing
  user, not just ones who asked for this.
- **Fold unresponsive links into the existing `broken` reason set.** Rejected:
  conflates a deterministic, always-actionable failure with a flaky,
  network-dependent one — a broken CI run from a transient 503 would erode
  trust in `broken` link reports generally.
- **Fixed retry interval regardless of failure state.** Rejected: either too
  slow to notice a real recovery, or (if set short enough to notice quickly)
  hammers a domain that's genuinely down. Backoff gets both.

## Consequences

- The liveness sidecar is new _stored state_, not just a cache — `--prune`
  needs to know about orphaned liveness records the same way it already
  prunes orphaned summary sidecars.
- `interval` is a cron expression and `intervalWhenStalled` is a duration
  string (`"1d"`) — two different config shapes for two different jobs, not
  numeric hours for either. Both are human-readable as written, and both
  avoid the earlier `intervalHours`-shaped (numeric) design this ADR
  superseded during review; `interval` itself was further revised from an
  initial duration-string design (`"7d"`) to a cron expression specifically
  so a fleet of URLs checked together converges onto shared runs (see
  Decision) — a config-shape change worth calling out here since it's easy
  to assume both fields share one shape when they don't.
