---
'@sledorze/cairn': patch
---

Internal CI/tooling improvements since v0.1.0: a relative perf-regression gate
(`pnpm bench`, local pre-push hook + CI backstop covering both source-level
micro-benchmarks and the actual built `dist/cli.js` startup time), automated
patch/minor Dependabot PR merging, and this automated release flow itself
(changesets/action wiring up git tags, changelogs, and GitHub Releases, which
were silently missing for the v0.1.0 publish). No user-facing behavior change.
