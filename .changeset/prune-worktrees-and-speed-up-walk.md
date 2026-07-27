---
'@sledorze/cairn': minor
---

Follow-up to the issue #63 walk fix. Two changes:

- **Linked git worktrees (e.g. `.claude/worktrees/<name>`) are now pruned automatically**, the same way a gitignored directory already is — via `git worktree list --porcelain`, zero configuration required. A linked worktree nests a full second copy of the repo's own doc tree inside the primary one; walking it used to double every summary/link finding, and if it had its own real `node_modules` checked out, could reintroduce the exact issue #63 OOM shape one directory deeper. Like the existing gitignore-based pruning, this is an always-on default that degrades gracefully (falls back to no worktree pruning) when git is unavailable, rather than failing.
- **The walk itself is faster.** Determining file-vs-directory for each entry used to cost a separate `fs.stat` call per entry on top of the `readdir` that already listed them. It now reads that type directly off the `Dirent` `readdir` already returns (`withFileTypes: true`), at no cost to crash-resilience — a broken symlink still needs (and gets) a link-following `stat` to resolve, and is still excluded rather than crashing the scan. Measured on a synthetic 16,400-entry fixture: median wall time dropped from ~143ms to ~27ms (~5×).
