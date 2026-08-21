---
'@sledorze/cairn': minor
---

`cairn check` now prints a one-time notice — `cairn 0.9.0 → 0.10.0 — see this package's own
CHANGELOG.md for what changed (config keys and conventions rarely show up in --help).` —
whenever the running cairn version differs from the one this repo was last stamped with.
Closes issue #155: most releases add config keys and Markdown conventions
(`checks.coverage.kinds`, `refs.scope`, `cairn-refs` fenced blocks, ...), deliberately
invisible in `--help` — so nothing routed a reader to the one place that actually explains
what changed, `CHANGELOG.md`, which already ships in the package (issue #134). Confirmed
real via two independent upgrade experiences reported on the issue, one spanning 7 minor
versions with zero signal either way.

Read-only on a plain `cairn check` — the notice repeats every run, same as any other
reported drift, until the next `cairn check --stamp` (any stamp mode: bare `--stamp`,
`--summaries-only --stamp`, `--refs --stamp`, `--migrate-stamps`) records the current
version to a new, single, repo-level `.cairn/version.json` sidecar and silences it. A
repo's very first `--stamp` ever (no prior sidecar) records the version silently, with no
notice — there's no previous version to compare against, so it isn't an upgrade signal.
Suppressed under `--json`, same as every other human-readable line.
