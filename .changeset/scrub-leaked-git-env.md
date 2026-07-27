---
'@sledorze/cairn': patch
---

Fixes a real correctness gap: `cairn check` (and the underlying `GitFsLive` used for `onlyGitTracked`, gitignore-based pruning, and linked-worktree pruning) could silently consult the _wrong_ git repository when run from inside a git hook of a linked `git worktree` checkout. Git exports `GIT_DIR` into hook subprocesses in that case, and `GIT_DIR` silently overrides `-C <base>` — confirmed empirically, not assumed. Every `git` invocation in `src/io/Git.ts` now scrubs the canonical set of repository-pinning environment variables (`git rev-parse --local-env-vars`) before shelling out, so `-C base` is always authoritative regardless of the calling environment.

If you wire `cairn check` into a pre-commit or pre-push hook (as this repo's own README recommends) and work from a linked worktree, this changes which repository's tracked/ignored/worktree state your hook actually consults — previously it may have silently been the wrong one.
