---
'@sledorze/cairn': minor
---

New, opt-in `onlyGitTracked` config option (issue #48): when `true`, both summary-freshness scanning and link-target existence checks are restricted to `git ls-files`' tracked-or-staged set (the index, not just the last commit) — so a local run sees exactly the same file universe a fresh CI checkout would. An untracked doc is skipped entirely (no "missing summary"), and a link to an untracked file reports broken even if it's present on disk locally. Default `false`, byte-for-byte unchanged from today. When enabled, a missing/unavailable `git` binary is a hard error, never a silent fallback.
