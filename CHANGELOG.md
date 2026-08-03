# @sledorze/cairn

## 0.8.0

### Minor Changes

- 5b8ef62: Added `checks.docCoverage` (closes #108): nothing previously checked whether a source file is documented anywhere at all — `checks.coverage` only ever asks doc→doc questions, so a repo could be fully green and still have entire modules nobody wrote a word about. `checks.docCoverage` closes that gap without generating a markdown file per source file: it declares `sources` globs (the files that must be covered) and one or more named `coveredBy` groups (globs over doc files whose direct outbound links count as covering a source file — a source file is covered if ANY one group's docs link to it, not all of them), plus an `exempt` list for intentionally undocumented files.

  Opt-in via mere presence in config, like `checks.coverage` — no CLI flag, `checks.docCoverage: false` re-disables it when inherited from an `extends` preset. Direct links only, matching `checks.coverage`'s own non-transitive rule.

## 0.7.0

### Minor Changes

- 605797a: `checks.coverage` rules can now target `{ "external": "path" }` instead of a declared doc kind — closes the third check from issue #28's v1 scope: doc→code reference resolution. A rule like

  ```json
  "rules": [{ "from": "spec", "to": { "external": "path" }, "name": "verified_by" }]
  ```

  is satisfied only when a `spec` doc links to a path that really exists on disk (source code, a test, anything — not just another scanned/kind-classified doc). Unlike a kind-based `to`, this never makes its target eligible for orphan reporting.

  This is a **stricter** check for anyone already using `checks.coverage` with a rule whose `to` they intend to change to `{ "external": "path" }` — existing configs (every `to` still a plain kind-id string) are completely unaffected, and no existing rule silently changes meaning.

- 8b44b29: Added `cairn check --report-deletions` (closes #106): link-completeness and content hashing both assume tracked content persists, so deleting a doc on the correct belief that it's pure duplication could silently lose a heading or outbound reference that existed nowhere else — every other check stayed green afterward. `--report-deletions` compares the working tree against a git ref (`--deletions-since`, default `HEAD`) and reports which of a deleted doc's headings/link targets survive in no remaining doc.

  Informational only, by design — it never affects the exit code. Deleting genuinely redundant documentation is a good thing that should stay cheap; this makes a lossy deletion visible, it doesn't block it. Needs a real git repository.

- 185788f: `roots` entries that can only legitimately resolve inside the project directory (no `..` segment anywhere or absolute path) now fail loudly with a clear error if the resolved directory turns out to be a symlink pointing outside the project — closing a gap where a malicious PR could replace a configured root (e.g. `docs/`) with a symlink to reach content outside the repository.

  This is a **stricter** check: if you rely on a plain `roots` entry (e.g. the default `"docs"`) resolving via a symlink to somewhere outside your project directory, `cairn check` will now fail with `cairn: root "..." resolves to "...", a symlink pointing OUTSIDE the project directory`. If that's intentional, express it with a `..`-relative or absolute path instead — those are unaffected and continue to work exactly as before (this is how a legitimate monorepo sibling-docs setup, e.g. `roots: ["../shared-docs"]`, is already expected to be configured).

### Patch Changes

- 6077f61: `--prose-refs` was labelled a "migration aid" in `--help`, the README, and scaffolded agent guidance — discouraging exactly the permanent, ongoing use it was actually safe for (closes #105). A citation that still resolves is always silent, so only genuine drift is ever reported; wording across `--help`, the README, `AGENTS.md`/scaffolded skill files, and code comments now states that permanent/ongoing use is supported, not just a one-time migration step. No behavior change — text only.
- 94f3fc6: `checks.coverage` — a config-only opt-in check with no CLI flag of its own — is now mentioned in `cairn check --help` and `cairn --help` (closes #104). Previously it was invisible to anyone who hadn't already read the README or the JSON schema by hand.
- 70a7206: Fixed link-completeness rejecting a link from a parent `_SUMMARY.md` straight to a child directory's own `_SUMMARY.md` (closes #103). Previously only a bare directory link (e.g. `[docs/](./docs)`) satisfied the check; `[docs/](./docs/_SUMMARY.md)` was reported as a missing child link even though it points at the curated index — the more precise, GitHub-rendering-friendly destination, and exactly the artifact whose content hash the summary tree tracks for that child. Both link forms now count.

  This is a **loosening**: a repo that previously carried both links (the documented workaround) is unaffected; a repo that only ever wrote the bare directory link is also unaffected. No existing passing config can newly fail.

- f75f07a: Fixed `ignore` glob patterns silently failing to match when written root-relative with no leading `**/` — the form anyone actually writes for a top-level path, e.g. `.agents/**` or `docs/SKIP.md` (closes #102). Previously only a pattern that either equalled the absolute filesystem path or was `**/`-prefixed (able to absorb an arbitrary prefix) actually excluded anything; every other pattern matched nothing, with no warning, leaving `cairn check` demanding summaries for directories the config believed were excluded.

  `ignore` patterns are now matched against both the absolute path (unchanged, so any pattern that already worked keeps working) and the path relative to the containing root — for directory pruning and for every checker's file-level `ignore` filter (links, refs, prose-refs, coverage, summaries) alike.

  This can newly EXCLUDE content from a repo's scan: if your `ignore` config already contains a pattern that happened to do nothing before (silently), that pattern may now correctly prune matching files/directories. Review your `ignore` list if `cairn check` reports fewer files checked after upgrading.

## 0.6.0

### Minor Changes

- 7d7b787: New, opt-in structural coverage/orphan check for teams using cairn to organize product knowledge (PRDs, specs, requirements, decision logs), not just code docs. Off by default — presence of `checks.coverage` in config is itself the opt-in, nothing changes for anyone who doesn't configure it.

  Declare doc kinds by path glob and a rule that every doc of one kind must link somewhere to a doc of another:

  ```json
  "checks": {
    "coverage": {
      "kinds": [
        { "id": "feature", "select": { "by": "path", "glob": "product/features/**" } },
        { "id": "decision", "select": { "by": "path", "glob": "docs/adr/**" } }
      ],
      "rules": [{ "from": "feature", "to": "decision" }],
      "exempt": ["product/features/templates/**"]
    }
  }
  ```

  Two file-level report classes, plus a config-level warning:

  - **missing coverage** — a `from`-kind doc with no outbound link to a `to`-kind doc.
  - **orphan** — a doc of a kind that's supposed to be referenced (a rule's `to` side) with zero inbound references from anywhere in the scanned corpus.
  - **unmatched kind** (⚠️, never fails the build) — a declared kind that matched zero scanned docs, most often because its glob falls outside `roots` (a kind's glob classifies docs cairn already scans, it never widens `roots` itself) or is simply mistyped. Without this, that mistake reads as `"✅ Coverage OK (0 doc(s) checked)"` — indistinguishable from a genuinely green repo.

  `exempt` (globs) opts a doc out of BOTH missing-coverage and orphan reporting entirely, not orphan status alone — the same escape hatch Sphinx's `:orphan:` and MkDocs' `not_in_nav` needed to keep their equivalent checks tolerable.

  A rule may carry an optional `name` (e.g. `"implements"` vs. `"verified_by"`) to distinguish two rules that share the same `from`/`to` kind pair but mean different things — two identically-named (or unnamed) rules on the same pair still dedupe as one. Every rule's `from`/`to` must reference a kind id declared in `kinds` — a typo there is now a loud config error at decode time, not a check that silently, permanently reports everything as missing. A rule may also carry an optional `via: { "by": "link" }`, naming how it's satisfied — the only implemented value today, and the implicit default when omitted, but a discriminated field (not hardcoded logic) so a future requirement type is a new value, not a breaking config change.

  This is the one check requirements-traceability tooling, safety-critical audit standards (DO-178C, IEC 62304), and doc generators (Sphinx, MkDocs, Confluence, Obsidian) have all independently converged on as foundational — and it's conspicuously absent from Markdown-specific lint tooling and every ADR tool. Reuses cairn's own existing link-extraction — no new Markdown syntax to author.

- 4f7a5aa: `checks.coverage` can now be re-disabled with `false`, letting a local config override an `extends` preset that enabled it — the same escape hatch `checks.links`/`checks.summaries` already had via their own booleans. Previously, once a preset turned coverage on, there was no way for a descendant config to turn it back off short of replacing `kinds`/`rules` with empty arrays (which still left the check enabled, just vacuously).

  Also fixes the README's own `checks.coverage` example: kind globs are matched against absolute filesystem paths, so a bare relative glob like `"product/features/**"` could never match a real scan — the example now correctly uses `"**/product/features/**"`, consistent with how the default `ignore` (`"**/node_modules/**"`) already works. The matching behavior itself is unchanged; only the documented example was wrong.

- 4f7a5aa: **Behavior change**: `cairn check` now exits non-zero when no configured root resolves to anything on disk (e.g. the default `docs/` doesn't exist and nothing else is configured) — previously this printed a `⚠️ No documentation roots found` warning but still exited 0, indistinguishable from genuine success by exit code alone, the one thing most CI/automation actually checks. The warning message is unchanged; `--json`'s `exitCode` field is corrected too, not just the process exit code.

  If your CI currently relies on the old lenient behavior (e.g. a pipeline stage that runs before any docs exist yet), configure `roots` to point somewhere that already exists, or gate the `cairn check` step accordingly.

### Patch Changes

- ed4d1e9: Fixes two more instances of the same quadratic-time (ReDoS) regex shape just fixed in the Markdown link checker's `LINK_RE` (see the sibling changeset in this release) — found by auditing the codebase for the same unbounded `[^\]]*`/`[^)\s]+` pattern rather than waiting for another one to surface independently. Both are real, reachable with ordinary (or adversarial) document content, not theoretical: `Anchors.ts`'s heading-anchor slugging (an inline link/image inside a heading, reduced to its own text before computing the anchor) and `ProseRefs.ts`'s bare-backtick-citation scanning (masking a real Markdown link's text span before candidate extraction) both scan every heading/every document's prose respectively. Fixed the same way — bounding every previously-unbounded quantifier at a generous 2000 characters — restoring linear-time scanning in both.
- a1953ae: Two fixes to the Markdown link checker, both in the same link-extraction regex:

  1. **False dead-link report for a `<...>`-wrapped destination.** CommonMark's own way to let a URL contain a literal `)` without it being confused for the link's own closing paren (a real, not-uncommon shape for Wikipedia/LibreTexts-style URLs) — `[text](<https://example.com/path_(with_parens)/more>)`. The link-extraction regex captured the `<`/`>` delimiters as part of the target instead of reading verbatim to the matching `>` first, which had two effects: an internal `)` truncated the captured target mid-URL, and — more broadly — the leaked leading `<` broke scheme detection (`isCheckableTarget`) so _any_ angle-bracket-wrapped external URL, parens or not, was mistaken for a local relative path and reported broken. Both are fixed; a bare (non-angle) destination's existing paren-truncation behavior is unchanged, since that ambiguity is exactly what `<...>` exists to resolve.

  2. **A real, pre-existing quadratic-time (ReDoS) vulnerability**, present since before this file's angle-bracket support was ever added — flagged by CodeQL (`js/polynomial-redos`) and confirmed empirically (a crafted doc with many unclosed `[` sequences and no closing `]` scaled the link scan quadratically with content length, a real denial-of-service risk on untrusted or messily-authored Markdown, not a theoretical finding). Fixed by bounding every previously-unbounded quantifier in the link-matching regex at a generous 2000 characters — link text and destinations are realistically far under that — restoring linear-time scanning.

- 4f7a5aa: `cairn init`'s scaffolded agent guidance (`AGENTS.md`, `CLAUDE.md`'s Claude rule, Copilot instructions, the `cairn` skill) now names every opt-in check — `--refs`, `--prose-refs`, and `checks.coverage` — not just the always-on summaries+links baseline. Previously an agent working in a fresh repo had no way to discover these features short of separately reading the npm README, which a repo-scoped agent doesn't naturally do.

## 0.5.1

### Patch Changes

- d801615: Fixes a false "0 files, all clean" from `cairn check`: `listWorktreeDirs` already excluded `base` itself from the worktree-pruning list, but not a worktree that is an ANCESTOR of `base` on disk — the exact shape produced when a linked worktree is nested inside another worktree's own directory (e.g. `<primary>/.claude/worktrees/<name>`, as an agentic dev workflow creates) rather than living as a sibling under a shared parent. Running `cairn check` from inside such a nested worktree turned the ancestor's path into an `ignore` pattern that also matched every file under the current scan root, silently excluding it entirely. Worktrees that are ancestors of `base` are now excluded from the result the same way `base` itself already was.

## 0.5.0

### Minor Changes

- f002b95: Fixes a real OOM crash (issue #63): pointing `roots` at or near a repository root (e.g. `roots: ["."]`) used to fully walk and `stat` every file under any ignored directory — including a real `node_modules` — before `ignore` was ever consulted, since filtering only ever happened after the whole tree was already materialized. `ignore` (and the default `"**/node_modules/**"` pattern) now prunes a matching directory during the walk itself, never descending into it at all.

  Also new: cairn now consults `.gitignore` automatically (via `git ls-files --others --ignored --exclude-standard --directory`) to prune gitignored directories the same way, with zero configuration — a gitignored `build/`, `dist/`, or similarly-named directory that doesn't happen to match a configured `ignore` glob is pruned too. This is an always-on default, independent of `onlyGitTracked`; unlike `onlyGitTracked`, it degrades gracefully (falls back to `ignore`-only pruning) rather than failing when `git` is unavailable or the directory isn't a git repository, since it's a safety net, not an opt-in guarantee.

  One named, deliberate scope decision: for `cairn check --links-only`, a link pointing _into_ a pruned directory (previously resolvable, since `ignore` only affected the source-scan set, not the existence universe) now reports broken instead. Considered an acceptable trade — a doc legitimately linking into an ignored directory is a vanishingly rare case next to the tool no longer OOM-crashing on an ordinary repository.

- f002b95: Follow-up to the issue #63 walk fix. Two changes:

  - **Linked git worktrees (e.g. `.claude/worktrees/<name>`) are now pruned automatically**, the same way a gitignored directory already is — via `git worktree list --porcelain`, zero configuration required. A linked worktree nests a full second copy of the repo's own doc tree inside the primary one; walking it used to double every summary/link finding, and if it had its own real `node_modules` checked out, could reintroduce the exact issue #63 OOM shape one directory deeper. Like the existing gitignore-based pruning, this is an always-on default that degrades gracefully (falls back to no worktree pruning) when git is unavailable, rather than failing.
  - **The walk itself is faster.** Determining file-vs-directory for each entry used to cost a separate `fs.stat` call per entry on top of the `readdir` that already listed them. It now reads that type directly off the `Dirent` `readdir` already returns (`withFileTypes: true`), at no cost to crash-resilience — a broken symlink still needs (and gets) a link-following `stat` to resolve, and is still excluded rather than crashing the scan. Measured on a synthetic 16,400-entry fixture: median wall time dropped from ~143ms to ~27ms (~5×).

- 4eab988: `effect`, `@effect/platform-node`, and `github-slugger` are no longer regular `dependencies` — the published `cairn` CLI (`dist/cli.js`) is fully bundled by esbuild and never needed them resolvable from a consumer's `node_modules` at runtime, so every install of cairn was pulling all three in for nothing.

  The concrete harm: `@effect/platform-node@4.0.0-beta.100` declares a _required_ (non-optional) peer dependency on `ioredis@^5.7.0`. Package managers with auto-install-peers behavior (e.g. pnpm) were therefore installing a real `ioredis` into every consumer's dependency graph purely to satisfy that peer — even though cairn never touches Redis. That `ioredis` could then become peer-satisfying for an unrelated package elsewhere in a consumer's tree, silently flipping which build variant that unrelated package resolved to. Removing the runtime dependency removes `ioredis` (and any other transitive peer surface from that chain) from ever reaching consumers.

  `effect` and `github-slugger` are still needed by cairn's unbundled programmatic library export (`import { ... } from '@sledorze/cairn'`) — they're now declared as **optional** `peerDependencies` instead. This is a behavior change worth flagging if you use that entrypoint: your own `package.json` must now declare `effect` and `github-slugger` directly (`pnpm add effect github-slugger`) — they will no longer show up for free via cairn. If you only use the `cairn` CLI, this changes nothing for you: nothing extra installs, and nothing extra is required.

### Patch Changes

- fb1a499: Fixes a real correctness gap: `cairn check` (and the underlying `GitFsLive` used for `onlyGitTracked`, gitignore-based pruning, and linked-worktree pruning) could silently consult the _wrong_ git repository when run from inside a git hook of a linked `git worktree` checkout. Git exports `GIT_DIR` into hook subprocesses in that case, and `GIT_DIR` silently overrides `-C <base>` — confirmed empirically, not assumed. Every `git` invocation in `src/io/Git.ts` now scrubs the canonical set of repository-pinning environment variables (`git rev-parse --local-env-vars`) before shelling out, so `-C base` is always authoritative regardless of the calling environment.

  If you wire `cairn check` into a pre-commit or pre-push hook (as this repo's own README recommends) and work from a linked worktree, this changes which repository's tracked/ignored/worktree state your hook actually consults — previously it may have silently been the wrong one.

  Also hardens the same code path against a second, independent failure mode: `GitFsLive` now sets `GIT_CEILING_DIRECTORIES` (git's own repository-discovery boundary) alongside the env scrub, so a `base` without its own `.git` can no longer silently resolve to an ancestor repository instead of failing.

  **A third, unrelated bug found while dogfooding this fix, also fixed here:** `listWorktreeDirs` excluded "whichever worktree `git worktree list` reports first" instead of excluding `base` itself — those are the same thing only when `base` is the primary worktree. Running `cairn check` from a **linked** worktree (not the primary) left `base` itself in the reported worktree list; `cli.ts` adds every reported worktree to its `ignore` list as `${dir}/**`, so this silently excluded the entire scan root — a false "0 files, all clean" instead of an error. If you run `cairn` from a linked git worktree, this is a real behavior change: it now actually scans your files, where before it silently scanned nothing.

  Fixed alongside it: the same exclusion now also resolves symlinks before comparing (`git worktree list` reports its own realpath-resolved form regardless of the literal path a worktree was reached through — confirmed empirically), so a `base` reached through a symlinked path (e.g. macOS's `/tmp` resolving to `/private/tmp`) can't reintroduce the identical bug in symlink form. Also hardened against a worktree directory deleted without `git worktree remove` first (an ordinary mistake) — a stale `prunable` entry with a path that no longer exists on disk no longer crashes the scan.

## 0.4.0

### Minor Changes

- 70c809e: `cairn check --fix` now auto-repairs a broken heading anchor (same-page and cross-file) when it differs from a real heading/`<a id="...">` anchor by case alone — an unambiguous, exact match, never a fuzzy guess. Two case-colliding anchors, or no match at all, are left unchanged and still reported, same as today (issue #49). Also fixes a related, pre-existing bug found while implementing this: a same-page anchor with URL-encoded characters (e.g. `#Setup%2DPattern`) is now percent-decoded before matching/suggesting, matching how cross-file anchors were already handled.
- 2213b86: New, opt-in `onlyGitTracked` config option (issue #48): when `true`, both summary-freshness scanning and link-target existence checks are restricted to `git ls-files`' tracked-or-staged set (the index, not just the last commit) — so a local run sees exactly the same file universe a fresh CI checkout would. An untracked doc is skipped entirely (no "missing summary"), and a link to an untracked file reports broken even if it's present on disk locally. Default `false`, byte-for-byte unchanged from today. When enabled, a missing/unavailable `git` binary is a hard error, never a silent fallback.
- 303047f: New, opt-in `cairn check --prose-refs` (issue #47): flags a bare-backtick file citation in prose (e.g. `` `src/services/auth.ts` ``, no `[text](path)` syntax at all) whose target has actually moved, been renamed, or deleted. Deliberately a migration aid, not a permanent second link checker — a citation that still resolves is always silent, and the report names the exact Markdown link syntax that would make it structurally checkable going forward, rather than just saying "broken." Off by default, not part of the `checks.links`/`checks.summaries` gate.

### Patch Changes

- 2b9cfed: Bug fixes found via systematic adversarial dimension-coverage review of three recently-shipped features:

  - `cairn check --fix`: a broken link/anchor target repeated more than once in the same file (an ordinary authoring pattern — e.g. mentioned in prose and again in a "See also" list) was fully and correctly repaired on disk, but incorrectly reported as still broken for its second occurrence (wrong `fixed` count, wrong exit code, spurious entry in `broken`/`--json`).
  - `cairn check --prose-refs`: a citation with trailing whitespace inside the backticks (e.g. `` `src/x.ts ` ``) was silently reported as drifted even though the trimmed path resolves fine — a false positive on ordinary input. An absolute-path-shaped citation is no longer treated as a candidate (a real filesystem path, not a repo-rooted one). A backtick citation that's already inside a real Markdown link's text is no longer double-reported alongside the link checker.
  - `cairn check --prose-refs`/`--refs`: now respect `ignore` and `onlyGitTracked`, matching every other check — previously silently scanned/stamped excluded or untracked docs regardless.

- 55bd736: Fixes several real, user-triggerable crashes found via adversarial "no unhandled exception" review — `cairn check` (and `--refs`/`--prose-refs`) previously died with a raw internal stack trace, instead of a clean report, when scanning a docs tree containing:

  - a broken symlink,
  - an unreadable (permission-denied) subdirectory,
  - a permission-denied doc file.

  A **nested** broken symlink or unreadable subdirectory is now silently excluded from the scan (matching how an ordinary non-file directory entry is already treated) — but a **root** directory (the one you actually configured/passed) that can't be read at all still fails the run rather than being treated as empty: an earlier version of this fix conflated the two, and a permission-denied root silently reported `✅ OK, 0 file(s) checked` with exit 0 — a false "all clear" that's worse than the original crash, caught by a second, independent round of adversarial review before this shipped.

  A permission-denied doc file is new, explicit, and non-silent for `cairn check`/`--links-only`: it's listed in a new `unreadable` field on the link-check result (also surfaced in `--json`), reported clearly, and makes the run exit non-zero. `--summaries-only`, `--refs`, and `--prose-refs` skip an unreadable doc without crashing, matching the same "never crash on one bad file" guarantee, though deliberately without the richer `unreadable` reporting `--links-only` gets (a wider fix there would touch `SummaryPlan`'s widely-consumed pure shape) — for `--summaries-only` specifically, an unreadable-but-existing summary currently reads as `missing` rather than distinctly `unreadable`, a known, named scope decision, not silently glossed over.

  Also fixes a latent (currently unreachable) correctness landmine found via review of the recent `applyFixesToFile` extraction: the decision of whether to write a repaired file back to disk is now driven by `applyFix`'s own `changed` flag end-to-end, not by comparing before/after file content as strings — the two can legitimately disagree when a suggested replacement is textually identical to the original.

## 0.3.0

### Minor Changes

- 2b4f930: New, opt-in `cairn check --refs` (issue #39, Scenario I, v1/whole-file): with `--stamp`, records the content hash of every real reference a doc makes (a cross-file or cross-hierarchy link target) into `.cairn/refs/**`; without `--stamp`, reports any whose target content has changed since — "may be stale," a distinct signal from a broken link, since the target still exists and the link still resolves. Not part of the default `checks.links`/`checks.summaries` gate; must be explicitly requested.
- 2b4f930: `cairn check`'s link checker now validates heading anchors (`[text](./guide.md#section)` and same-page `[text](#section)`, GitHub-slug compatible) and resolves link targets outside the configured `roots` as long as they stay inside the repository checkout — both previously silently accepted regardless of whether they were actually true. It also validates GitHub-style line anchors (`#L10`, `#L10-L20`) on such cross-hierarchy targets. Existence/anchor checks for anything outside the checkout root are never attempted, by design. `BrokenLink` gained an additive, optional `reason: 'path' | 'anchor' | 'line'` field in `--json` output.

  This can flip a previously-green repo to red: an anchor or cross-hierarchy link that was never actually checked before may now be reported broken if it doesn't really resolve.

## 0.2.0

### Minor Changes

- 7f170c0: Move the summary freshness stamp out of file content into a hidden, hierarchy-mirroring `.cairn/**` sidecar tree, so tracking metadata never pollutes authored prose and can grow (e.g. future per-relation manifests) without ever touching a content file.

  - `cairn check --stamp` now writes `.cairn/<mirrored-path>.json` instead of a `<!-- source-sha256 -->` comment inside the summary; summary content is never mutated by the tool.
  - **Upgrading requires no new command.** `--stamp` (already what every existing `.cairnrc.json`'s `stampCommand` runs) now self-heals: it strips any leftover legacy in-content stamp it finds and writes the `.cairn/` sidecar in the same pass. `cairn check --migrate-stamps` also exists as an explicitly-named alias of the same behavior, purely for anyone who wants the cleanup reported as its own step — it is never required.
  - `cairn check --prune` now also removes orphan `.cairn/**` sidecars (a sidecar with no matching source doc — a deletion signal the old in-content scheme couldn't see once the summary file itself was also deleted).
  - Breaking: `CheckSummariesArgs`/`checkSummaries`/`stampSummaries`/`explainSummaries`/`pruneOrphans` (programmatic API) now require a `base` field (the project root sidecars are resolved under). `PlanArgs`/`SummaryPlan` in the pure planner gained an optional `stamps` input and a new `orphanStamps` output field.
  - `.cairn/` must be committed (not gitignored) alongside your docs, same as the old stamp comment was.

## 0.1.1

### Patch Changes

- 8aa909b: Internal CI/tooling improvements since v0.1.0: a relative perf-regression gate
  (`pnpm bench`, local pre-push hook + CI backstop covering both source-level
  micro-benchmarks and the actual built `dist/cli.js` startup time), automated
  patch/minor Dependabot PR merging, and this automated release flow itself
  (changesets/action wiring up git tags, changelogs, and GitHub Releases, which
  were silently missing for the v0.1.0 publish). No user-facing behavior change.
