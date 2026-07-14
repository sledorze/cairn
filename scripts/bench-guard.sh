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

# Also src/cli.ts and package.json (a `typescript`/`esbuild` devDependency bump, or a
# direct cli.ts edit, is exactly what the CLI-startup synthetic benchmark below exists
# to catch — confirmed by testing: without these two, a real injected startup
# regression in cli.ts was silently skipped since it isn't itself a benchmarked
# src/core/*.ts hot path).
HOT_PATHS='^src/core/(SummaryTree|glob|MarkdownLinks|DocSummaries)\.ts$|^src/io/DocsFs\.ts$|^src/program/CheckSummaries\.ts$|^src/cli\.ts$|^package\.json$'

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

# Uses THIS checkout's (HEAD's) copy of bench-cli-startup.ts for both timings, same
# reasoning as bench.yml (see that workflow's comment): the worktree at MERGE_BASE
# won't have the script yet the first time this lands, and cross-referencing HEAD's
# copy from the worktree's own directory keeps dist/cli.js resolving to that ref's
# own build either way.
HEAD_DIR="$(pwd)"
git worktree add --detach --quiet "$WORKTREE_DIR" "$MERGE_BASE"
(
  cd "$WORKTREE_DIR"
  pnpm install --frozen-lockfile --silent
  pnpm exec vitest bench --run --outputJson "$TMP_DIR/before.json" >/dev/null
  pnpm build >/dev/null
  pnpm exec tsx "$HEAD_DIR/scripts/bench-cli-startup.ts" "$TMP_DIR/before.json" >/dev/null
)

pnpm exec vitest bench --run --outputJson "$TMP_DIR/after.json" >/dev/null
pnpm build >/dev/null
pnpm exec tsx scripts/bench-cli-startup.ts "$TMP_DIR/after.json" >/dev/null

pnpm exec tsx scripts/bench-assert.ts "$TMP_DIR/before.json" "$TMP_DIR/after.json"
