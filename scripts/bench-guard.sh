#!/usr/bin/env bash
# Pre-push perf-regression guard. Compares the hot-path benchmarks (src/core/*.bench.ts)
# between the push's base ref and HEAD, in a scratch git worktree, on THIS machine —
# same reasoning as bench-assert.ts: a same-runner, back-to-back comparison avoids the
# cross-run CI-noise problem entirely, so a tight threshold is trustworthy.
#
# Scoped to only run when a hot-path file actually changed, so an unrelated push (docs,
# a README tweak) isn't slowed down by a worktree checkout + install + bench run.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

HOT_PATHS='^src/core/(SummaryTree|glob|MarkdownLinks|DocSummaries)\.ts$|^src/io/DocsFs\.ts$|^src/program/CheckSummaries\.ts$'

BASE_REF="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [ -z "$BASE_REF" ]; then
  echo "bench-guard: no upstream branch configured yet (first push?) — skipping."
  exit 0
fi

MERGE_BASE="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || true)"
if [ -z "$MERGE_BASE" ]; then
  echo "bench-guard: could not resolve a merge-base with $BASE_REF — skipping."
  exit 0
fi

if [ "$MERGE_BASE" = "$(git rev-parse HEAD)" ]; then
  echo "bench-guard: nothing new to push — skipping."
  exit 0
fi

if ! git diff --name-only "$MERGE_BASE" HEAD | grep -Eq "$HOT_PATHS"; then
  echo "bench-guard: no hot-path file changed since $BASE_REF — skipping."
  exit 0
fi

echo "bench-guard: hot-path file changed — comparing HEAD against $BASE_REF ($MERGE_BASE)..."

WORKTREE_DIR="$(mktemp -d)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

git worktree add --detach --quiet "$WORKTREE_DIR" "$MERGE_BASE"
(
  cd "$WORKTREE_DIR"
  pnpm install --frozen-lockfile --silent
  pnpm exec vitest bench --run --outputJson "$TMP_DIR/before.json" >/dev/null
)

pnpm exec vitest bench --run --outputJson "$TMP_DIR/after.json" >/dev/null

pnpm exec tsx scripts/bench-assert.ts "$TMP_DIR/before.json" "$TMP_DIR/after.json"
