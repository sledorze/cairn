# @sledorze/cairn

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
