# Roadmap: issue #101 (`--refs` granularity)

**What this roadmap actually is** (required disclosure, per `CONVENTION.md`'s "judging
this convention" section): the releases below sequence shippable increments for THIS
package by engineering dependency, not a business-tradeoff prioritization — there is no
market/customer-value ranking here, just what needs what to be buildable first. This
package declares no dependency on another package's state (no
`external-dependency-kind` frontmatter) — see [`../dependencies.md`](../dependencies.md)
for the one real cross-package relation that DOES exist in this repo (`137-typed-relations`
depends on this package's Release 1 output).

**Release 1 has shipped** (`refs.scope`, below — see `docs/adr/0004-refs-scoped-hashing-granularity.md`,
now `accepted`). Releases 2/3 below remain provisional, unchanged, gated as this doc already
states.

Three releases, each independently shippable and independently valuable — not a single
big-bang redesign. Each release closes with the same falsification discipline this repo
uses everywhere else (`AGENTS.md`'s "Shipping one iteration well," `CheckDocCoverage`'s own
real-CLI dogfooding pass): a real repro, a real fix, a real before/after check.

**Why Release 1 ships separately instead of going straight to Release 2, stated honestly:**
[`spikes.md`](./spikes.md) already confirms Release 2's core mechanism (the `createScanner`-based
export-boundary finder) is real and low-cost BEFORE this roadmap was written — so "Release
1 first because Release 2 is too risky to attempt yet" is NOT the actual justification, and
this document shouldn't imply it is. The real justification is narrower: Release 1 needs
zero new runtime dependency and zero unresolved design questions (no open
signature-vs-whole-declaration question the way Release 2 has), so it can ship and
immediately resolve the one confirmed repro (`problem-space.md`'s evidence-basis section)
while Release 2's one open question gets resolved with real evidence rather than
speculation. This is a real, if modest, reason to sequence rather than combine — not
schedule padding, but also not a load-bearing technical dependency between the two.
A team that already has Release 2's open question resolved (e.g. by prototyping both
signature-only and whole-declaration hashing against real repos before committing) could
reasonably combine Release 1+2 into one shipped increment instead; this roadmap's
two-release split is the more CONSERVATIVE sequencing, not the only valid one.

## Release 1 — `refs.scope` config: per-glob unit, `whole-file` (default) | `ignore`

**Ships:** solution-space option D, narrowed to its cheapest useful slice — no new
`unit` values beyond what exists today (`whole-file`) plus an escape hatch
(`ignore`, meaning "don't track this glob under `--refs` at all"). Config shape mirrors
`checks.docCoverage`'s own named-glob-group convention
(`core/Config.ts`'s `DocCoverageGroupInputSchema`), for consistency, not because it's
required for correctness at this step:

```json
"refs": {
  "scope": [{ "glob": "src/checking/*.ts", "unit": "ignore" }]
}
```

**Directly resolves:** the reporter's OWN reported repro — exempt the 14 leaves, keep (or
drop) whole-file tracking on whatever remains.

**Does NOT yet resolve:** the general case where a repo has no natural leaf/facade split to
draw an `ignore` boundary around. Release 2 is what actually removes the NEED for a facade
restructure.

**Migration:** `refs.scope` absent means every previously-tracked target keeps its
`whole-file` unit — zero behavior change for existing users. No existing sidecar becomes
invalid.

## Release 2 — `unit: "exports-only"`: API-surface hashing (solution-space option B)

**Ships:** the token-scan-based export-declaration finder validated in `spikes.md` (spike
4, `typescript/unstable/ast`'s `createScanner`). `stampRefs`/`checkRefs` branch on the
matched `unit`: `whole-file` behaves exactly as today (`resolveReferenceContent`'s existing
path, untouched); `exports-only` hashes the CONCATENATED set of exported declaration
signatures (not bodies — see `implementation-details.md`'s open question on whether bodies
belong in v1) found by the scanner, in source order (stable hash across insignificant
reordering-neutral edits... actually NOT reordering-neutral, see that doc's own caveat).

**Directly resolves:** the general case, with no facade restructure required — this
release is the fix the reporter's OWN restructure was independently working around.

**Language scope for v1:** TypeScript/JavaScript only (the languages `typescript`'s scanner
already parses). A repo whose cited targets are a different language falls back to
`whole-file` for those globs automatically (unmatched-language files are never silently
"treated as exports-only with zero exports found," which would be a false green — see
`problem-space.md` constraint 1). A future language needs its own scanner adapter; not
blocking for v1's own value (this repo's own dogfooded target — its own `src/**/*.ts` —
is exactly the language this release covers first).

**Report upgrade:** `StaleRef` gains an optional `changedSymbols?: readonly string[]` field
(populated only for `exports-only` targets) — `story-map.md`'s "which export changed" story.
`whole-file` targets keep reporting with the field absent, matching this repo's own
"unknown/absent key is always tolerated, never a breaking schema bump" sidecar convention
(`RefStore.ts`'s own header comment on `REFS_VERSION`).

**Migration:** switching a glob from `whole-file` to `exports-only` invalidates that
target's existing recorded hash (the hash's MEANING changed) — the next `--refs` run
reports every such target as newly-untracked (needs a fresh `--stamp`), not silently stale
or silently trusted. This is a deliberate, loud, one-time re-stamp, not a bug — surfaced
explicitly in the CLI output (a distinct message from "content drifted," matching
`story-map.md`'s own "`--stamp` should tell me when a config change means mass-restamp"
story) so a user doesn't mistake "expected, config-driven" for "did something break."

## Release 3 — symbol-scoped citations (`#name` anchors), solution-space option A

**Ships:** when a citation carries an anchor AND its target glob's `unit` is
`exports-only` (or a new `unit: "symbol"`, TBD at implementation time), narrow the hash to
just the ONE matching declaration (spike 4's scanner already locates it) instead of the
whole exports set.

**Directly resolves:** the residual case Release 2 doesn't — one file with many
independently-changing exports, where even export-SURFACE granularity is still noisy for a
citation that only cares about one of them (`solution-space.md`'s own "only clearly
justified once real usage of B surfaces this" gate).

**Hard requirement before this ships, not optional polish:** rename resilience.
[`story-map.md`](./story-map.md)'s "renaming a cited symbol should be an actionable error, not a silent
false-pass" story is THE gating story for this release — Release 1/2 have no equivalent
failure mode (a whole-file or export-SET target can't "disappear" the way one specific
named symbol can). Ship only once this has its own real test proving a renamed-away anchor
is reported distinctly from ordinary content drift.

**Trigger for actually starting this release:** real usage data from Release 2 — not a
fixed calendar date. If Release 2 alone resolves every real report for N months, Release 3
stays a documented option, not committed work (mirrors this repo's own general bias: ship
the smallest slice that's actually needed, confirmed real, before building the next one).

## Explicitly out of scope for all three releases

- Solution-space option C (git-diff/indent heuristic) — rejected in `solution-space.md`,
  not resurrected here.
- Any change to `checks.docCoverage` (issue #108) itself — `problem-space.md`'s constraint
  4 keeps these two features' link-parsing paths sharing `extractReferences` but otherwise
  independent; this roadmap adds no new coupling between them.
- Cross-repo/cross-package symbol citation (citing a symbol in a DIFFERENT package's
  published `.d.ts`) — every release here operates within one `base`, same boundary
  `isWithinBase` already enforces everywhere else in this codebase.
