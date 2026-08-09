# Roadmap: issue #151 (root-level docs reachable by cairn)

One release, deliberately scoped small — not a multi-release sequence like
`docs/design/101-refs-symbol-scoping/`'s roadmap. [`spikes.md`](./spikes.md) already
confirms the core primitive is a small, localized change; there's no equivalent of that
design's "parser dependency, staged by risk" reason to split this into stages. What follows
is the single shippable increment, realizing [`story-map.md`](./story-map.md)'s own
walking-skeleton slice, plus the explicit scoping decision `problem-space.md`'s constraint
3 demands, and the migration note for PR #148.

## Release 1 — literal-file `roots` entries, consumed as a second `--links-only` invocation

**Ships:** solution-space option 1's primitive (`expandOne`/`isDir` in `config.ts`,
`listFiles`/`walk` in `DocsFs.ts` accept a file-shaped root — see
`implementation-details.md` for the concrete diff shape, grounded in `spikes.md`'s trace),
used the way option 4 describes: a **second**, narrow `cairn check` invocation —

```
cairn check --links-only --root AGENTS.md --root README.md --root CLAUDE.md
```

(or the config-file equivalent — a small dedicated `.cairnrc.rootdocs.json` with `roots:
["AGENTS.md", "README.md", "CLAUDE.md"]`, run via `--config`) — run **alongside**, not
instead of, the existing `cairn check` invocation against `docs/`. Two CI steps (or two
lines in one script), not a merged config: `layerConfig` only resolves one config per run
(`core/Config.ts:1110`), so there is no single-invocation way to say "check summaries and
coverage for `docs/`, but only links for these three root files" — `solution-space.md`
already covers why this isn't a gap worth closing with a new per-root-scoping schema field
for one release's worth of value.

**Directly resolves:** the reported pain — a broken link in `AGENTS.md`/`README.md`/
`CLAUDE.md` now fails `cairn check` (via the second invocation), the same guarantee every
doc under `docs/` already has.

## Explicit scoping decision: summaries/coverage do NOT extend to file-roots in Release 1

**Decided, and justified, not left implicit** (per `problem-space.md`'s constraint 3):
Release 1 makes file-roots work for **link-checking only**, via `--links-only`. It does
NOT make `AGENTS.md` (or any file-root) subject to `checks.summaries`'s directory-summary
requirement, or `checks.coverage`/`checks.docCoverage`'s kind-matching.

**Why this is the right default, not just the cheapest one:**

- `checks.summaries`'s per-file summary requirement exists for docs that are big enough
  that a reader benefits from a fast-to-read digest sibling — `AGENTS.md.summary.md`
  sitting at the repo root next to `AGENTS.md` is a genuinely odd artifact nobody asked
  for; `AGENTS.md` is already, itself, meant to be the dense, curated top-level reference
  (its own file header: "keep it lean... a bloated file causes Claude to ignore the rules
  that matter"). A generated summary of an already-curated summary-shaped file adds
  confusion, not clarity.
- `checks.coverage`'s design-package kind-matching is scoped by path glob
  (`**/docs/design/*/...`) and simply won't match a root file regardless — no explicit
  exemption is even needed for THAT check; it's `checks.summaries`/`checks.docCoverage`
  that would need one if file-roots were folded into the main invocation.
- Scoping via a SEPARATE `--links-only` invocation, rather than a new
  per-root-obligation config field, sidesteps the question entirely: an invocation that
  never enables `checks.summaries` in the first place can't accidentally apply it to a
  file-root. This is the same reasoning `spikes.md`'s Spike 3 trace already surfaced as a
  side effect for free: since `SummaryTree.ts`'s `planSummaries` only builds
  directory-summary obligations by walking UP from a doc's own directory while that
  directory `isInScope(d, roots)`, and a file-root's own containing directory (the repo
  root) is never itself declared a root, a file-root generates NO directory-summary
  obligation even if `checks.summaries` WERE left on — but this design still ships with
  `--links-only` explicitly, rather than relying on that as the only guard, since relying
  on an implicit side effect of unrelated logic to stay correct is exactly the kind of
  un-obvious invariant a future refactor could break silently.

**Open question, deliberately left open, not force-resolved:** should a FUTURE release
let a file-root opt IN to summary/coverage checking (e.g. because a team wants
`README.md` itself linked from `checks.docCoverage`'s `coveredBy` groups)? Nothing in
Release 1 forecloses that — it would be a config-level decision (a per-root `unit`/unit
flag, echoing `docs/design/101-refs-symbol-scoping/roadmap.md`'s own `refs.scope`
per-glob-unit convention) for a later release, not resolved speculatively here. No real
report has asked for it yet.

## Migration note: PR #148 should be closed/superseded, not merged

[PR #148](https://github.com/sledorze/cairn/pull/148) (`agentsMdLinks.unit.test.ts`)
proposes a narrower, bespoke version of exactly what Release 1 makes generic — reusing
`extractReferences` (the right instinct, matching `--refs`'s own extractor) but
re-implementing its own resolution-base logic outside `checkLinks`, checking only
`AGENTS.md`, not `README.md`/`CLAUDE.md`, and with no connection to `checks.coverage`/
`checks.docCoverage` the way a real root-file `cairn check` invocation gets by
construction. Once Release 1 ships:

- The PR's own test becomes fully redundant with the new `--links-only` root-file
  invocation (same underlying extractor, broader coverage, zero bespoke resolution
  logic).
- **Close/supersede PR #148 rather than merge it** — merging it after Release 1 ships
  would recreate exactly the "two independent, drifting mechanisms answering the same
  question" risk `problem-space.md`'s constraint 4 and `docs/design/101-refs-symbol-scoping/`'s
  own constraint 5 both warn against for `--refs`/`checks.docCoverage`. A fourth bespoke
  test surviving alongside a working generic fix is the anti-pattern this whole design
  exists to end, not a harmless leftover.
- If Release 1 slips or is deprioritized, PR #148 remains a reasonable INTERIM stopgap —
  its existence isn't wasted work, but it should be explicitly labeled as "supersede once
  #151 Release 1 ships," not merged as if it were the permanent answer.

## Explicitly out of scope for this release

- Any change to `--refs`'s own granularity (`docs/design/101-refs-symbol-scoping/`) — a
  file-root becoming `--refs`-eligible is a natural follow-on once Release 1 ships (an
  `AGENTS.md` citation of real `src/**` code would then be reachable the same way a
  `docs/architecture.md` citation is today), but it is not this design's problem to solve.
- A merged, single-invocation config that scopes different checks to different root
  groups within one run — `solution-space.md` already explains why `layerConfig`'s
  one-config-per-run shape makes this a bigger primitive than one release's reported pain
  justifies; revisit only if a second, independent report asks for it.
- Extending `checks.coverage`/`checks.docCoverage` to treat a file-root as a legitimate
  `coveredBy`/kind-matching target — the open question above, deliberately deferred.
