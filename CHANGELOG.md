# @sledorze/cairn

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
