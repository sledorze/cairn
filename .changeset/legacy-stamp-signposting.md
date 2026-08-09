---
'@sledorze/cairn': patch
---

`cairn check --summaries-only` now tells a legacy in-content `<!-- source-sha256: ... -->` stamp (pre-`.cairn/` sidecar format) apart from genuine content drift. Previously both showed the same generic `stale (source changed)`, which reads as alarming, undifferentiated mass drift on a repo upgrading off the old format — the actual fix (`--migrate-stamps`, or an ordinary self-healing `--stamp`) wasn't discoverable at the point of failure. Affected summaries now report `legacy inline stamp (format migration, not drift)`, and the report ends with a line pointing straight at `cairn check --summaries-only --migrate-stamps`. No behavior change to what's stale/missing or to exit codes — output only (issue #142, item #1).
