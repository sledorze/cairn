---
'@sledorze/cairn': minor
---

Fixes a real OOM crash (issue #63): pointing `roots` at or near a repository root (e.g. `roots: ["."]`) used to fully walk and `stat` every file under any ignored directory — including a real `node_modules` — before `ignore` was ever consulted, since filtering only ever happened after the whole tree was already materialized. `ignore` (and the default `"**/node_modules/**"` pattern) now prunes a matching directory during the walk itself, never descending into it at all.

Also new: cairn now consults `.gitignore` automatically (via `git ls-files --others --ignored --exclude-standard --directory`) to prune gitignored directories the same way, with zero configuration — a gitignored `build/`, `dist/`, or similarly-named directory that doesn't happen to match a configured `ignore` glob is pruned too. This is an always-on default, independent of `onlyGitTracked`; unlike `onlyGitTracked`, it degrades gracefully (falls back to `ignore`-only pruning) rather than failing when `git` is unavailable or the directory isn't a git repository, since it's a safety net, not an opt-in guarantee.

One named, deliberate scope decision: for `cairn check --links-only`, a link pointing _into_ a pruned directory (previously resolvable, since `ignore` only affected the source-scan set, not the existence universe) now reports broken instead. Considered an acceptable trade — a doc legitimately linking into an ignored directory is a vanishingly rare case next to the tool no longer OOM-crashing on an ordinary repository.
