---
'@sledorze/cairn': patch
---

Packaging fix: `CHANGELOG.md` is now included in the published npm tarball (`files` in
`package.json`) — previously it was generated on every release but never shipped, so
upgrading consumers had no in-package way to see what changed.

Docs fixes: README's `cairn init --agent` documentation now lists all 5 real values
(`claude`, `copilot`, `agents`, `opencode`, `all` — `agents`/`opencode` were previously
missing from both the command table and the prose), and README now documents that `--json`
cannot be combined with `--stamp`, `--migrate-stamps`, `--report-deletions`, `--refs`,
`--prose-refs`, `checks.coverage`, `checks.docCoverage`, or `checks.freshness` (each errors
out explicitly rather than silently ignoring a flag).
