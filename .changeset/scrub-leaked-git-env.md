---
'@sledorze/cairn': patch
---

Fixes a real correctness gap: `cairn check` (and the underlying `GitFsLive` used for `onlyGitTracked`, gitignore-based pruning, and linked-worktree pruning) could silently consult the _wrong_ git repository when run from inside a git hook of a linked `git worktree` checkout. Git exports `GIT_DIR` into hook subprocesses in that case, and `GIT_DIR` silently overrides `-C <base>` — confirmed empirically, not assumed. Every `git` invocation in `src/io/Git.ts` now scrubs the canonical set of repository-pinning environment variables (`git rev-parse --local-env-vars`) before shelling out, so `-C base` is always authoritative regardless of the calling environment.

If you wire `cairn check` into a pre-commit or pre-push hook (as this repo's own README recommends) and work from a linked worktree, this changes which repository's tracked/ignored/worktree state your hook actually consults — previously it may have silently been the wrong one.

Also hardens the same code path against a second, independent failure mode: `GitFsLive` now sets `GIT_CEILING_DIRECTORIES` (git's own repository-discovery boundary) alongside the env scrub, so a `base` without its own `.git` can no longer silently resolve to an ancestor repository instead of failing.

**A third, unrelated bug found while dogfooding this fix, also fixed here:** `listWorktreeDirs` excluded "whichever worktree `git worktree list` reports first" instead of excluding `base` itself — those are the same thing only when `base` is the primary worktree. Running `cairn check` from a **linked** worktree (not the primary) left `base` itself in the reported worktree list; `cli.ts` adds every reported worktree to its `ignore` list as `${dir}/**`, so this silently excluded the entire scan root — a false "0 files, all clean" instead of an error. If you run `cairn` from a linked git worktree, this is a real behavior change: it now actually scans your files, where before it silently scanned nothing.

Fixed alongside it: the same exclusion now also resolves symlinks before comparing (`git worktree list` reports its own realpath-resolved form regardless of the literal path a worktree was reached through — confirmed empirically), so a `base` reached through a symlinked path (e.g. macOS's `/tmp` resolving to `/private/tmp`) can't reintroduce the identical bug in symlink form. Also hardened against a worktree directory deleted without `git worktree remove` first (an ordinary mistake) — a stale `prunable` entry with a path that no longer exists on disk no longer crashes the scan.
