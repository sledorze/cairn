---
'@sledorze/cairn': patch
---

Fixes a false "0 files, all clean" from `cairn check`: `listWorktreeDirs` already excluded `base` itself from the worktree-pruning list, but not a worktree that is an ANCESTOR of `base` on disk — the exact shape produced when a linked worktree is nested inside another worktree's own directory (e.g. `<primary>/.claude/worktrees/<name>`, as an agentic dev workflow creates) rather than living as a sibling under a shared parent. Running `cairn check` from inside such a nested worktree turned the ancestor's path into an `ignore` pattern that also matched every file under the current scan root, silently excluding it entirely. Worktrees that are ancestors of `base` are now excluded from the result the same way `base` itself already was.
