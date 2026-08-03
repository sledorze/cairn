---
status: proposed
---

# `--refs` hashing granularity: scope config first, export-surface hashing second, symbol citations only if still needed

## Context

Issue #101: `--refs`'s whole-file content hashing (`resolveReferenceContent`,
`CheckRefs.ts:83`) makes any edit to a cited file — including edits that change nothing a
doc actually claims — fail `cairn check`. Reported for real (dogfooding cairn 0.6.0 on
`sledorze/falsestart`): a doc citing 14 implementation files failed on every unrelated edit
to any of them, until the reporter restructured their source tree to add a facade
(`index.ts`) layer per area and re-cited 6 facades instead of 14 leaves.

That restructure is evidence of a real gap, not a non-issue: **a documentation tool caused
an architectural change** the reporter says they would not otherwise have made, and the
workaround doesn't generalize to a repo without (or unwilling to add) a facade layer. This
repo's own `checks.docCoverage` (issue #108, shipped just before this ADR) makes the
problem concrete here too: cairn's own `.cairnrc.json` now cites dozens of `src/**/*.ts`
files directly from `docs/architecture.md`, by design — turning `--refs` on for this repo
today would hit exactly this issue.

**Evidence basis, stated plainly:** this is one reported case (issue #101, zero comments/
reactions from anyone besides the reporter, who is also cairn's own maintainer) plus one
directly-connected, independently-verifiable instance in this repo's own dogfooded config
(`--refs` deliberately not enabled here yet, for exactly this reason). Not broad
multi-user corroboration — see `problem-space.md`'s own "Evidence basis" section for the
full, undiluted framing. This ADR proceeds anyway because the repro is concrete and the
root-cause analysis holds regardless of how many people have hit it yet, but the
investment size (three releases, one new dependency) should be read against this actual
evidence base, not an inflated one.

Full analysis: `docs/design/101-refs-symbol-scoping/problem-space.md`
(root cause, constraints), `solution-space.md` (five options evaluated, one rejected),
`spikes.md` (real feasibility evidence — notably, `typescript@^7.0.2`'s classic
`ts.createSourceFile` API is NOT available at its root export in this repo's own pinned
version; `typescript/unstable/ast`'s `createScanner` is, and was confirmed to work
standalone against a real file in this repo).

## Decision

Ship in three independent, individually-valuable releases (`roadmap.md`'s own ordering,
reproduced here as the decision record):

1. **`refs.scope`: per-glob `unit` config, `whole-file` (default, unchanged) | `ignore`.**
   Zero new dependencies. Fully resolves the reporter's own reported repro (exempt the
   noisy leaves). Ships first because it's the cheapest real fix and needs no parser.
2. **`unit: "exports-only"`: hash a file's exported-declaration set, not its full bytes.**
   Built on `typescript/unstable/ast`'s `createScanner` (spike-validated, zero new
   dependency). Solves the GENERAL case the reporter's restructure was independently
   working around — this release is what makes that restructure unnecessary for future
   users. Exports hashed in a canonical (name-sorted, not source-order) order, so a
   meaning-preserving reordering of exports is never reported as drift.
3. **Symbol-scoped citations (`#exportName` anchors), narrowing to one declaration.**
   Citation SYNTAX already works today (`extractReferences` already parses `#anchor`
   generically — confirmed by inspection, `spikes.md` spike 1) — the remaining cost is
   entirely in `CheckRefs.ts`/`RefStore.ts` acting on it. Gated behind real usage evidence
   that Release 2's export-surface granularity is still too coarse for some real case, AND
   behind a hard rename-resilience requirement (a renamed-away cited symbol must produce a
   distinct, actionable report, never a silent false-pass) — not committed as scheduled
   work, only as a documented, spiked-feasible option.

**Rejected:** a git-diff/indent-based heuristic (no parser dependency, but a
backtracking-prone boundary-detection approach this repo's own conventions already steer
away from — see `solution-space.md` option C for the full reasoning). Not revisited by a
future reader without new information that changes that tradeoff.

**Explicitly NOT decided by this ADR** (flagged in `implementation-details.md` as open,
resolved at Release-2-implementation time with real evidence, not speculatively here):
whether `exports-only` hashes the exported SIGNATURE only or the whole exported
declaration including its body.

## Consequences

- `--refs` gains its first config-level surface (`refs.scope`) — previously pure-CLI-flag.
  Namespaced as a new top-level `refs` key, not nested under `checks.*`, since `--refs`
  itself stays a per-invocation CLI opt-in (`refsPlugin.isEnabled = (_resolved, cli) =>
cli.refs`, `CheckRefs.ts`), unlike `checks.coverage`/`checks.docCoverage`'s
  config-presence-gated model; this ADR does not change that distinction. `CheckRefs.ts`
  already exports a `refsPlugin: CheckPlugin<RefsCheckResult>`, already registered in
  `cli.ts` — `refs.scope` is new config threaded into that EXISTING plugin's `run`, not a
  new registry integration (an earlier design draft incorrectly treated this as an open
  question; see `docs/design/101-refs-symbol-scoping/implementation-details.md`'s own
  correction note).
- `typescript` moves from a build-only `devDependency` to an optional `peerDependency`
  (Release 2 only), matching the existing `effect`/`github-slugger` precedent — never a
  hard, always-installed runtime dependency.
- `RefRecord`'s shape grows an optional `exportHashes` field for `exports-only` targets
  (Release 2) — additive, no `REFS_VERSION` bump, no change to existing `whole-file`
  records' shape (`RefStore.ts`'s own codec already tolerates unknown/absent optional
  keys).
- Switching a glob's `unit` from `whole-file` to `exports-only` is a deliberate, one-time,
  LOUDLY-reported mass re-stamp (the hash's meaning changed) — not silently treated as
  either "still fresh" or ordinary drift. Implementers must distinguish these two report
  reasons in the CLI output.
- New dependency surface: `typescript/unstable/ast`'s `createScanner`, explicitly marked
  `unstable` by its own maintainers. Implementation must isolate this behind one narrow
  internal module (a single `extractExportRanges` function, not scattered call sites) so a
  future `typescript` major that reshuffles this surface again is a one-module fix.
- Cairn's own `.cairnrc.json` remains WITHOUT `--refs` enabled until at least Release 1
  ships — enabling it today, before this design, would reproduce issue #101's own failure
  mode on this repo (see `problem-space.md`'s "why this matters beyond one issue" section).
  Enabling `--refs` here for real, once Release 1 or 2 exists, is itself a good future
  dogfooding step (mirroring how `checks.docCoverage`'s own PR #122 dogfooded issue #108) —
  not committed as part of this ADR, but a natural next real-world validation once the
  mechanism exists.

## Alternatives considered

See `solution-space.md` for the full five-option comparison (A/B/C/D/E) with pros/cons;
summarized in the Decision section above. `roadmap.md` and `story-map.md` carry the
release sequencing and user-story justification for the ordering chosen; `spikes.md`
carries the evidence this decision relies on being real rather than assumed.
