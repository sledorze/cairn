---
'@sledorze/cairn': patch
---

A plain `cairn check` failure now ends with a one-line pointer to `--explain` when there's a
stale or missing summary to explain (`Tip: run with --explain to see why each summary above is
stale or missing.`). Previously the flag existed but the failure output never mentioned it, so
discovering it required already knowing to look for it. The hint never appears on `--explain`
runs themselves, on a clean run, or on an orphans-only failure (nothing in `--explain`'s scope
to explain there).
