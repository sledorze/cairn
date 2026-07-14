# Handoff — resuming work on `cairn`

You are working on **cairn** (`@sledorze/cairn`) in a clone of
https://github.com/sledorze/cairn (private, branch `main`). Read this, then
bootstrap the repo before doing anything else.

## What cairn is

A standalone, reusable CLI. It enforces a convention of **hierarchical
documentation summaries** plus a **dead-link** check.

- File summary `X.summary.md` for every `.md` over the threshold (default 30 lines).
- Directory summary `_SUMMARY.md` aggregating direct children and linking each.
- **Freshness by content hash** (`<!-- source-sha256: … -->`), NOT mtime: git does
  not preserve mtimes, so a time-based check silently passes on stale summaries after
  a clone. It is a Merkle tree of docs — regenerate leaves-first, then deepest
  directories, then stamp → converges in one pass.
- **Two layers** (the core design): (1) _enforcement_ = the agent-agnostic CLI (the
  CI guarantee); (2) _guidance_ = `cairn init` renders ONE convention body into
  `.claude/rules/*.md` (`paths:`), `.github/instructions/*.instructions.md`
  (`applyTo:`), an `AGENTS.md` block, a `SKILL.md`, and (for `--agent claude`/`all`) a
  root `CLAUDE.md` that imports AGENTS.md — Claude Code auto-loads CLAUDE.md at session
  start but never reads AGENTS.md on its own.

## Getting started (clean devcontainer)

Open in the devcontainer ("Reopen in Container") — `postCreate.sh` provisions
everything (Node 22, pnpm via corepack, gh, gitleaks, hadolint, zsh, lefthook).
Otherwise, by hand: `corepack enable && pnpm install --frozen-lockfile`. Then
**validate**: `pnpm verify` (= lint + typecheck + test + build + check). Expected:
86 tests green, "Markdown links OK", "Hierarchical summaries OK".

## Commands

- `pnpm verify` — the full gate (run it before and after any change).
- `pnpm check` / `pnpm stamp` — check docs / (re)stamp summaries.
- `pnpm dev -- <args>` — the CLI in dev (e.g. `pnpm dev -- init --agent all`).
- `pnpm test:watch`, `pnpm lint`, `pnpm typecheck`, `pnpm format`.

## Structure (separation of concerns)

- `src/core/` — **pure, zero-dependency** logic, reasons in **POSIX** (`path.posix`):
  `DocSummaries` (hash/stamp/classify), `MarkdownLinks` (extract/strip-code/check/fix),
  `SummaryTree` (hierarchical planner), `glob`, `paths`.
- `src/io/DocsFs.ts` — Effect service (Live Node + `makeTestDocsFs` in-memory);
  normalises paths to `/` at the boundary.
- `src/program/` — Effect programs (`CheckLinks`, `CheckSummaries`, `locale`).
- `src/config.ts` (impure edge: `.cairnrc.json` + root-glob expansion), `src/cli.ts`,
  `src/init/` (guidance generator; prose lives in `init/content.ts`).
- Colocated tests `*.unit.test.ts` / `*.integration.test.ts` (vitest).

## Non-negotiable principles

- **Every fix becomes an enforced rule** (test/check/CI/hook), never a manual fix. A
  deliberate non-goal is locked by a test that pins the behaviour.
- **"Documentation will not be read → enforce, don't document."**
- Never `git ... --no-verify`. The CI (`lint→typecheck→test→build→check`) and lefthook
  (pre-commit: gitleaks/hadolint/oxlint/prettier/docs; pre-push: verify) are the gates.
- The repo **dogfoods itself** (`pnpm check` on its own `docs/`).

## Gotchas already hit (do not re-trip on them)

- lefthook is a **local** devDependency → invoke it via `pnpm exec lefthook`, never bare.
- `pnpm.onlyBuiltDependencies: ["lefthook"]` is required (pnpm 10 blocks build scripts).
- `packageManager: "pnpm@10.11.0"` is required (else `pnpm/action-setup` fails in CI).
- prettier **ignores `pnpm-lock.yaml`** (`.prettierignore`); oxlint is **pinned to 1.73.0**
  with stylistic rules disabled.
- The npm package publishes **`dist` only** (`files: ["dist"]`) — never the tests.
- To validate the devcontainer, run the **actual `bash .devcontainer/postCreate.sh`**
  in a fresh clone, not just `pnpm install`.

## Deliberate non-goals (pinned by tests — do not "fix")

- **Indented** (4-space) code blocks are not stripped (ambiguous with list nesting →
  would cause false negatives). Only fenced ` ``` ` / `~~~` and `inline code` are stripped.
- Cross-file heading anchors are not validated (out of scope for file existence).

## Remaining work (user's call — ASK before any outward action)

1. **npm publish**: make the repo **public**, then `changeset publish` (`--access public`,
   `provenance` via CI OIDC). Outward actions → confirm first.
2. **Adopt cairn in a consuming repo**: add it as a dev dependency, wire `cairn check`
   into CI and git hooks, and run `cairn init` to generate the agent guidance.
3. CI: a non-blocking Node 20 deprecation warning from the GitHub actions (upstream).
