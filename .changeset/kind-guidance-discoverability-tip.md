---
'@sledorze/cairn': minor
---

`cairn check --refs`'s stale-reference report now ends with a one-time tip pointing at
`checks.coverage.kinds` when a real stale reference exists and no kinds are configured —
closing a real discoverability gap where the kind-aware guidance feature (#143) had zero
signal in its own output that it existed at all, unless you'd already read the README.

Absent on a clean run (nothing to gain guidance about) and absent once `checks.coverage` is
configured (no nagging after opting in) — only shown when it's actually actionable.
