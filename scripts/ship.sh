#!/usr/bin/env bash
# Consolidates the mechanical half of "take a change from branch to open PR" into
# one command, per AGENTS.md's "Shipping one iteration well": full local verify
# every push, a changeset for user-facing changes, rebased onto latest main before
# pushing. The parts that need judgment (does this change need review? what's the
# PR description?) are NOT automated here — the `ship` skill (.claude/skills/ship/)
# wraps this script with those steps, including the mandatory adversarial review.
#
# Deliberately fails loud and stops at the first problem rather than trying to fix
# things automatically (e.g. no auto-resolving rebase conflicts) — this repo's own
# "Content-mutation safety" convention: a script that writes to the working tree
# without a human decision point is exactly the failure class AGENTS.md warns about.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "==> Checking environment preconditions"
if ! gh auth status >/dev/null 2>&1; then
  echo "ship: gh is not authenticated (gh auth status failed). Run 'gh auth login' first."
  exit 1
fi
if [ -z "$(git config user.email || true)" ]; then
  echo "ship: git user.email is not configured. Run 'git config user.email <you>' first."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "ship: working tree is not clean. Commit or stash first:"
  git status --short
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BASE_REF="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
if [ "$BRANCH" = "${BASE_REF#origin/}" ]; then
  echo "ship: refusing to ship directly from $BRANCH — create a feature branch first."
  exit 1
fi

echo "==> Fetching and rebasing onto $BASE_REF"
git fetch origin
git rebase "$BASE_REF" || {
  echo "ship: rebase onto $BASE_REF hit a conflict. Resolve it manually (see AGENTS.md on"
  echo "never hand-resolving a generated/sidecar conflict), then re-run 'pnpm ship'."
  exit 1
}

echo "==> Running full local verify (lint, typecheck, test, build, check)"
pnpm verify

echo "==> Checking for a required changeset"
bash scripts/check-changeset.sh "$BASE_REF"

echo "==> Pushing $BRANCH"
git push --force-with-lease -u origin "$BRANCH"

echo "==> Checking for an existing PR"
PR_URL="$(gh pr view --json url -q .url 2>/dev/null || true)"
if [ -z "$PR_URL" ]; then
  echo "ship: no open PR for this branch yet. Run 'gh pr create' (the ship skill does this"
  echo "with a real description, not this script — a PR description needs judgment, not"
  echo "just mechanics)."
else
  echo "ship: PR already open: $PR_URL"
  echo "==> Polling CI status"
  gh pr checks --watch || true
fi

echo "==> Done. PR: ${PR_URL:-<none yet>}"
