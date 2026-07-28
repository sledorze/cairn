---
'@sledorze/cairn': minor
---

**Behavior change**: `cairn check` now exits non-zero when no configured root resolves to anything on disk (e.g. the default `docs/` doesn't exist and nothing else is configured) — previously this printed a `⚠️ No documentation roots found` warning but still exited 0, indistinguishable from genuine success by exit code alone, the one thing most CI/automation actually checks. The warning message is unchanged; `--json`'s `exitCode` field is corrected too, not just the process exit code.

If your CI currently relies on the old lenient behavior (e.g. a pipeline stage that runs before any docs exist yet), configure `roots` to point somewhere that already exists, or gate the `cairn check` step accordingly.
