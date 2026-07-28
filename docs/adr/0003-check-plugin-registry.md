---
status: accepted
---

# A CheckPlugin registry for links/refs/proseRefs/coverage — summaries stays hand-wired

## Context

Investigating "what verification could we build atop `checks.coverage`" surfaced three
candidate ideas (cardinality rules, heading-scoped references, stale-coverage-link
freshness tracking) and a separate question: how do tools like ESLint let a plugin bring
its own config schema into a shared config file? Researching ESLint's actual
architecture (`meta.schema` per rule, a plugin's `rules` namespace, flat-config
`plugins`) and applying it to cairn's own 5 checks (`CheckLinks.ts`, `CheckSummaries.ts`,
`CheckRefs.ts`, `CheckProseRefs.ts`, `CheckCoverage.ts`) found: every check is hand-wired
individually into `cli.ts` (5 separate `if` blocks), each importing its own
`checkX`/`formatXReport`/`xExitCode` trio — an informal convention, no shared interface.
Adding a check today means touching `cli.ts`'s dispatch, its `--json` incompatibility
guards (3 near-identical copies), and (for a check that should appear in `--json`)
`JsonReport.ts`'s hardcoded shape.

A first design sketch (a full `CheckPlugin<Config, Result>` interface with `dependsOn`
for cross-plugin data sharing, a config schema built generically from the registry, and
a once-computed shared doc-scan context) was adversarially critiqued before any code was
written. The critique found real breaks, not nitpicks:

1. `dependsOn` + a dependency's resolved CONFIG isn't enough for the deepest candidate
   (stale-coverage-links) — it needs the coverage graph's actual resolved EDGES (which
   ref satisfies which rule), which `checkCoverage` computed and then discarded inside a
   closure. The real fix is a shared, pure CORE extraction (`resolveRuleEdges`), not a
   registry-level dependency mechanism.
2. `checks.summaries`'s config isn't `checks.summaries` at all — `naming`,
   `thresholdLines`, `requireDirSummaries`, `stampCommand` are top-level `ResolvedConfig`
   fields. A `configSchema = checks.<name>` assumption is simply false for this check.
3. Enablement is modeled two incompatible ways today: `links`/`summaries` are `boolean`
   fields inside `checks`; `coverage` is presence-of-an-object (`null` = off); `refs`/
   `proseRefs` have no config field at all, CLI-flag-only.
4. A once-computed shared doc-scan context is unsafe the moment a `--fix`-capable check
   (links) and a doc-reading check (coverage) coexist — a stale pre-fix snapshot.
5. `--stamp` is already an overloaded, order-dependent CLI flag (summaries vs. refs);
   inventing `--stamp=<plugin>` would be new user-facing surface for a need only one
   check (`refs`) has today.

## Decision

Built a smaller, honest version of the registry, scoped to what four of the five checks
actually need, not a generalized plugin system:

- **`CheckPlugin<Result>`** (`src/program/checks/CheckPlugin.ts`): `isEnabled(resolved,
cli)`, `run(args)`, `format(result, opts)`, `exitCode(result)`, optional
  `jsonUnsupportedMessage` and `stamp`. `args: CheckRunArgs` carries the WHOLE
  `ResolvedConfig`, not a per-plugin config slice (closes finding #2 — a plugin reaches
  into whatever top-level fields it needs itself, same as it always did).
- **`runCheckPlugin`**/**`rejectedJsonMessage`** (`src/program/checks/runCheckPlugin.ts`):
  the generic runner (isEnabled → run → format → exitCode, matching the exact
  `--json` line-suppression cli.ts already did) and the upfront, order-preserving
  `--json` incompatibility gate that replaces 3 copy-pasted `if` guards with one.
- **`links`, `refs`, `proseRefs`, `coverage` migrate onto it** — each gains a plugin
  descriptor (`linksPlugin`, `refsPlugin`, `proseRefsPlugin`, `coveragePlugin`), thin
  wiring only, no change to any check's own logic. `refsPlugin.stamp` is the one
  concession to finding #5: a real, single capability, not a generalized verb system.
- **`summaries` deliberately stays hand-wired** in `cli.ts` (closes finding #2/#3): four
  CLI verbs (check/stamp/prune/migrate-stamps) that don't fit `run`/`format`/`exitCode`,
  and forcing them to would be exactly the "false generality" this design otherwise
  exists to avoid.
- **No shared doc-scan context, no `dependsOn`** (closes finding #1/#4): no two of the
  four migrated checks share a scan today, so there is no real second consumer to design
  around. Instead, `resolveRuleEdges` (`src/core/structure/Coverage.ts`) was extracted as
  a PURE core function out of `checkCoverage`'s own satisfaction loop — the actual answer
  to "how does a future stale-coverage-link check reuse coverage's resolution logic
  without duplicating it": a shared core function, called directly by whichever checks
  need it, not a registry-level dependency-injection mechanism.
- **cli.ts's 4 call sites stay in their original relative order**, each now calling the
  shared runner instead of hand-rolling isEnabled/format/exitCode inline — deliberately
  NOT collapsed into one iteration loop. Console output order and exit-code aggregation
  are real, observable CLI behavior; a single unified loop would risk silently reordering
  them. Verified byte-for-byte against the pre-refactor binary (not just the test suite)
  across every flag combination: plain check, `--links-only`, `--summaries-only`,
  `--json` (compatible and all 3 rejecting cases), `--refs` (check and `--stamp`),
  `--prose-refs`, `--fix`, and the `--refs --stamp` + summaries `--stamp` co-occurrence.

## Considered Options

- **The full `dependsOn`/generic-config-schema sketch**, as originally designed. Rejected
  after the adversarial critique — every one of its 5 findings pointed to the same
  lesson: build the registry the four REAL migrating checks need, not the one a
  hypothetical fifth might.
- **Migrate `summaries` too**, restructuring its config under `checks.summaries` to fit
  the `configSchema` pattern. Rejected: a breaking config-file change for zero behavioral
  gain, to make an abstraction "complete" rather than useful.
- **Collapse the 4 call sites into one iteration loop** over a `CHECKS` array. Rejected:
  real, if subtle, regression risk to console output order and Math.max exit-code
  aggregation for a cosmetic code-size win; the shared runner already removes the
  duplicated logic without that risk.

## Consequences

- Adding a FIFTH check that fits this shape (isEnabled/run/format/exitCode, optionally
  stamp) is now: write the plugin descriptor, add one call site in `cli.ts` in the right
  position, done — no `--json` guard to hand-copy, no separate exit-code aggregation to
  remember.
- `summaries` remains a structural exception, documented, not silently inconsistent — a
  future refactor that wants to unify it too would need to solve its four-verb shape
  first, not retrofit it into this one.
- **A real, pre-existing bug was found while dogfooding this refactor, unrelated to it**:
  `checks.coverage`'s kind globs are matched against ABSOLUTE filesystem paths (`DocsFs`
  always returns absolute, POSIX-normalised paths), but the README's own documented
  examples use relative globs (e.g. `"product/features/**"`) that can never match a real
  scan without a leading `**/`. Confirmed present on `origin/main` before this branch
  existed (bisected via `git stash`), so out of scope for this PR — needs its own fix
  (either matching against a root-relative path, or documenting the `**/` requirement
  loudly) as a follow-up.
- `resolveRuleEdges`'s every-satisfying-ref (not boolean) return shape is now the
  concrete foundation a future stale-coverage-link check, cardinality rule, or
  heading-scoped reference variant builds on — none of those three ideas need registry
  changes at all: cardinality and heading-scoping stay inside `checks.coverage`'s own
  `via` discriminated union (see docs/adr/0002); stale-coverage-links would be a genuinely
  new `checks.<name>` plugin consuming `resolveRuleEdges` directly, still undesigned.
