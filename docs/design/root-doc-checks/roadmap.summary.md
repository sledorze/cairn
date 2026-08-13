# Roadmap summary: issue #151 (root-level docs reachable by cairn)

Opens with a required disclosure: this roadmap sequences ENGINEERING dependency, not
business tradeoff, and declares no cross-package dependency (no `external-dependency-kind`
frontmatter) — see [`../dependencies.md`](../dependencies.md) for the relations that do
exist elsewhere in this repo.

One release, not a multi-stage sequence — `spikes.md` already confirms the primitive is
small.

**Release 1:** `expandOne`/`DocsFs.listFiles` accept a literal file-shaped root; consumed
via a second, narrow `cairn check --links-only` invocation scoped to `AGENTS.md`/
`README.md`/`CLAUDE.md`, run alongside (not merged into) the existing `docs/`-scoped
invocation — because `layerConfig` (`Config.ts:1110`) only resolves one config per run.

**Explicit scoping decision:** summaries/coverage do NOT extend to file-roots in Release
1 — a file-root only gets link-checking (`--links-only`), deliberately, so `AGENTS.md`
doesn't silently gain an unwanted `.summary.md` sibling. Justified, not just cheap: a
231-line curated instruction file gains nothing from an auto-generated digest of itself.
Left open for a later release, not resolved here: whether a file-root should be able to
opt IN to summary/coverage obligations.

**Migration note:** once Release 1 ships, PR #148 (`agentsMdLinks.unit.test.ts`) becomes
redundant with the new generic check and should be closed/superseded, not merged as a
permanent parallel mechanism.

Out of scope: `--refs` granularity (separate design), a single merged multi-root-group
config, and folding file-roots into `checks.docCoverage`'s `coveredBy` matching.

See [roadmap.md](./roadmap.md) for the full reasoning.
