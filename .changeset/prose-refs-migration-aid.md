---
'@sledorze/cairn': minor
---

New, opt-in `cairn check --prose-refs` (issue #47): flags a bare-backtick file citation in prose (e.g. `` `src/services/auth.ts` ``, no `[text](path)` syntax at all) whose target has actually moved, been renamed, or deleted. Deliberately a migration aid, not a permanent second link checker — a citation that still resolves is always silent, and the report names the exact Markdown link syntax that would make it structurally checkable going forward, rather than just saying "broken." Off by default, not part of the `checks.links`/`checks.summaries` gate.
