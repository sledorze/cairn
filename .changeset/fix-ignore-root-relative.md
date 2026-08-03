---
'@sledorze/cairn': patch
---

Fixed `ignore` glob patterns silently failing to match when written root-relative with no leading `**/` — the form anyone actually writes for a top-level path, e.g. `.agents/**` or `docs/SKIP.md` (closes #102). Previously only a pattern that either equalled the absolute filesystem path or was `**/`-prefixed (able to absorb an arbitrary prefix) actually excluded anything; every other pattern matched nothing, with no warning, leaving `cairn check` demanding summaries for directories the config believed were excluded.

`ignore` patterns are now matched against both the absolute path (unchanged, so any pattern that already worked keeps working) and the path relative to the containing root — for directory pruning and for every checker's file-level `ignore` filter (links, refs, prose-refs, coverage, summaries) alike.

This can newly EXCLUDE content from a repo's scan: if your `ignore` config already contains a pattern that happened to do nothing before (silently), that pattern may now correctly prune matching files/directories. Review your `ignore` list if `cairn check` reports fewer files checked after upgrading.
