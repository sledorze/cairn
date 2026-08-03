---
'@sledorze/cairn': minor
---

Added `checks.docCoverage` (closes #108): nothing previously checked whether a source file is documented anywhere at all — `checks.coverage` only ever asks doc→doc questions, so a repo could be fully green and still have entire modules nobody wrote a word about. `checks.docCoverage` closes that gap without generating a markdown file per source file: it declares `sources` globs (the files that must be covered) and one or more named `coveredBy` groups (globs over doc files whose direct outbound links count as covering a source file — a source file is covered if ANY one group's docs link to it, not all of them), plus an `exempt` list for intentionally undocumented files.

Opt-in via mere presence in config, like `checks.coverage` — no CLI flag, `checks.docCoverage: false` re-disables it when inherited from an `extends` preset. Direct links only, matching `checks.coverage`'s own non-transitive rule.
