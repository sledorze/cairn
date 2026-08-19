---
'@sledorze/cairn': patch
---

Fixes a false green in `cairn check --links-only` (and every check built on `stripCode`):
an inline code span (`` `code` ``) wrapped across a line break, followed by at least one more
backtick on the closing line, could silently swallow a real Markdown link — the link was
never reported, even when its target didn't exist. The old inline-code masking paired
backticks per LINE, losing the span's open/closed state across the line break; a wrapped
span's true closer was invisible to it, so the scan re-paired the OPENING backtick against
whatever came next on the CLOSING line instead, blanking out everything between — including
a real `[text](target)` link.

Fixed by masking inline code spans across the whole document, matching CommonMark's actual
rule (a span is delimited by a backtick RUN, closing at the next run of equal length,
wherever it falls — no same-line restriction) instead of a single-line regex. Wrapping a
code span across a line break is ordinary Markdown reflow and must not change link
extraction, whether the link comes from `--links-only`'s own dead-link report,
`checks.coverage`, `checks.docCoverage`, `checks.storyMapTiers`, or any other check built on
the same shared `stripCode` primitive.
