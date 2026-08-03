#!/usr/bin/env bash
# Closes issue #111: nothing enforced that a user-facing PR includes a changeset —
# AGENTS.md's own "Release convention" said to run `pnpm changeset`, but a missing
# one was caught only by an after-the-fact manual audit (twice, in this repo's own
# history: PRs #109/#110 both needed a follow-up "add changeset" commit).
#
# Same shape as scripts/bench-guard.sh: a shared script, driven by a shared path
# classifier (scripts/changeset-required-paths.regex / -exempt-paths.regex, mirroring
# scripts/bench-hot-paths.regex's own precedent), callable identically from
# lefthook's local pre-push hook and from CI — one definition of "does this diff
# need a changeset," not two copies that can drift apart.
#
# Deliberately NOT a heuristic guess at "internal vs user-facing" beyond the fixed
# path lists below: the escape hatch for a genuine false positive is Changesets' own
# `pnpm changeset --empty` (a real, committed `.changeset/*.md` with no package
# bump) — an explicit, visible-in-the-diff acknowledgment, not a silent skip. This
# was the issue's own explicit ask: "an explicit label... not a heuristic prone to
# false positives in either direction."
#
# Known, deliberate gap (not fixed here): `package.json` (a new dependency, a new
# `bin`/`exports` entry) is genuinely user-facing but not in the required-paths
# list. Adding it was tried and reverted — the changesets bot's own "Version
# Packages" PR also touches `package.json` while DELETING every consumed
# changeset, so a naive inclusion would fail the bot's own release PR unless
# specifically exempted (e.g. by branch name or by detecting "changesets only
# deleted, nothing added"), which is real added complexity this PR's scope
# (issue #111's own suggested direction: `src/**`) doesn't cover. A manual
# dependency-only PR without a changeset stays a real, known gap.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE_REF="${1:-}"
if [ -z "$BASE_REF" ]; then
  # Deliberately NOT `@{u}` (the current branch's own remote-tracking ref):
  # adversarial review found that wrong — `@{u}` compares against wherever
  # THIS branch was last pushed to, not the branch it will actually merge
  # INTO, so on a normal single-push workflow the diff against it is empty
  # (or, on a later push, only that push's own incremental commits) and the
  # check silently no-ops on exactly the case issue #111 is about: a fresh
  # PR's full diff against `main` missing a changeset. The actual merge
  # target is the repo's default branch — resolved from `origin/HEAD`'s own
  # symref (survives a renamed default branch), falling back to `origin/main`
  # if that symref was never set locally (e.g. a shallow/partial clone).
  BASE_REF="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
fi
if [ -z "$BASE_REF" ]; then
  BASE_REF="origin/main"
fi
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "check-changeset: base ref '$BASE_REF' does not resolve locally — skipping."
  exit 0
fi

MERGE_BASE="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || true)"
if [ -z "$MERGE_BASE" ]; then
  echo "check-changeset: could not resolve a merge-base with $BASE_REF — skipping."
  exit 0
fi

if [ "$MERGE_BASE" = "$(git rev-parse HEAD)" ]; then
  echo "check-changeset: nothing new relative to $BASE_REF — skipping."
  exit 0
fi

CHANGED_FILES="$(git diff --name-only "$MERGE_BASE" HEAD)"

INCLUDE_RE="$(cat scripts/changeset-required-paths.regex)"
EXEMPT_RE="$(cat scripts/changeset-exempt-paths.regex)"

USER_FACING="$(echo "$CHANGED_FILES" | grep -E "$INCLUDE_RE" | grep -Ev "$EXEMPT_RE" || true)"

if [ -z "$USER_FACING" ]; then
  echo "check-changeset: no user-facing file changed since $BASE_REF — skipping."
  exit 0
fi

# `--diff-filter=AR` (added or renamed), not a plain path match against
# `--name-only` — the changesets bot's own "Version Packages" PR DELETES
# every consumed changeset, and `--name-only` lists a deletion the same as
# an addition; matching either would make deleting a changeset look
# identical to adding one. `R` (not just `A`) matters too — adversarial
# review found `--diff-filter=A` alone excludes a legitimate "renamed my
# changeset file" edit (git reports that as a rename, not an add, by
# default whenever the content is similar enough), which would otherwise
# make a genuinely-present changeset register as missing.
if git diff --name-only --diff-filter=AR "$MERGE_BASE" HEAD | grep -Eq '^\.changeset/[^/]+\.md$'; then
  echo "check-changeset: user-facing change(s) found, and a changeset is present. OK."
  exit 0
fi

echo "check-changeset: user-facing file(s) changed with no new .changeset/*.md:"
echo "$USER_FACING" | sed 's/^/  /'
echo
echo "Run \`pnpm changeset\` and commit the result."
echo
echo "If this genuinely isn't a user-facing change despite matching the check above,"
echo "run \`pnpm changeset --empty\` instead — it still commits a real .changeset/*.md"
echo "(with no package bump), so the exemption is visible in the diff and in review,"
echo "not a silent skip."
exit 1
