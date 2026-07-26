---
'@sledorze/cairn': patch
---

Bug fixes found via systematic adversarial dimension-coverage review of three recently-shipped features:

- `cairn check --fix`: a broken link/anchor target repeated more than once in the same file (an ordinary authoring pattern — e.g. mentioned in prose and again in a "See also" list) was fully and correctly repaired on disk, but incorrectly reported as still broken for its second occurrence (wrong `fixed` count, wrong exit code, spurious entry in `broken`/`--json`).
- `cairn check --prose-refs`: a citation with trailing whitespace inside the backticks (e.g. `` `src/x.ts ` ``) was silently reported as drifted even though the trimmed path resolves fine — a false positive on ordinary input. An absolute-path-shaped citation is no longer treated as a candidate (a real filesystem path, not a repo-rooted one). A backtick citation that's already inside a real Markdown link's text is no longer double-reported alongside the link checker.
- `cairn check --prose-refs`/`--refs`: now respect `ignore` and `onlyGitTracked`, matching every other check — previously silently scanned/stamped excluded or untracked docs regardless.
