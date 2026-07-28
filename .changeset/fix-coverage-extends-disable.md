---
'@sledorze/cairn': minor
---

`checks.coverage` can now be re-disabled with `false`, letting a local config override an `extends` preset that enabled it — the same escape hatch `checks.links`/`checks.summaries` already had via their own booleans. Previously, once a preset turned coverage on, there was no way for a descendant config to turn it back off short of replacing `kinds`/`rules` with empty arrays (which still left the check enabled, just vacuously).

Also fixes the README's own `checks.coverage` example: kind globs are matched against absolute filesystem paths, so a bare relative glob like `"product/features/**"` could never match a real scan — the example now correctly uses `"**/product/features/**"`, consistent with how the default `ignore` (`"**/node_modules/**"`) already works. The matching behavior itself is unchanged; only the documented example was wrong.
