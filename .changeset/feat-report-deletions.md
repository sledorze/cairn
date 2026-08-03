---
'@sledorze/cairn': minor
---

Added `cairn check --report-deletions` (closes #106): link-completeness and content hashing both assume tracked content persists, so deleting a doc on the correct belief that it's pure duplication could silently lose a heading or outbound reference that existed nowhere else — every other check stayed green afterward. `--report-deletions` compares the working tree against a git ref (`--deletions-since`, default `HEAD`) and reports which of a deleted doc's headings/link targets survive in no remaining doc.

Informational only, by design — it never affects the exit code. Deleting genuinely redundant documentation is a good thing that should stay cheap; this makes a lossy deletion visible, it doesn't block it. Needs a real git repository.
