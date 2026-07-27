# cairn

A hierarchical, content-hashed documentation summary tree checker — verifies that every
doc has a fresh digest, every directory aggregates its children, and every link resolves.

## Language

**Broken link**:
A link whose target is deterministically resolvable-or-not from the repo's own content —
a missing local path, a same-page anchor with no matching heading, an out-of-range line
fragment. Always actionable the moment `cairn check` runs; never flaky.
_Avoid_: Dead link (reserve for the external-liveness sense, see below)

**Unresponsive link**:
An external `http(s)` URL that failed its liveness check — the network says no, not the
repo's own content. Distinct from a **broken link**: flaky by nature (a transient outage
looks identical to a real 404), so it is reported as its own warning class, never folded
into `broken`, and never fails `cairn check`'s exit code by default.
_Avoid_: Dead link, broken link

**Liveness check**:
An opt-in, scheduled HTTP request confirming an external URL still responds. One `cairn
check` run makes at most one attempt per **due** URL — there is no in-run retry loop.
_Avoid_: Retry, ping

**Due**:
A URL whose liveness sidecar says `now >= nextCheckAt`. Only due URLs are checked in a
given run; everything else is skipped without any network I/O.

**Stalled**:
A URL whose most recent liveness check failed. While stalled, its next check is pulled
earlier than the healthy `interval` cron schedule would give it, via
`intervalWhenStalled`'s backoff — not to retry harder, but to notice recovery sooner than
the normal (long) calendar cadence would.

**Interval** (cron expression):
The calendar-aligned schedule a healthy URL is re-checked on (e.g. `"0 0 * * 0"` for
weekly) — a _cron expression_, not a relative duration. `intervalWhenStalled` stays a
plain duration: it can only pull a stalled URL's next check EARLIER than `interval`'s
next calendar occurrence, never later.
