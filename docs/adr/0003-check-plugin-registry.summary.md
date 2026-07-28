# CheckPlugin registry: links/refs/proseRefs/coverage migrate, summaries stays hand-wired — summary

An investigation into "verification atop `checks.coverage`" plus ESLint's plugin
architecture led to a `CheckPlugin` abstraction — but a smaller, honest one, after an
adversarial critique of the first sketch found 5 real breaks (a `dependsOn` mechanism
that didn't actually give a future stale-link check what it needs; `summaries`'s config
isn't shaped like `checks.summaries` at all; enablement is modeled 3 different ways
today; a shared doc-scan cache is unsafe with `--fix`; `--stamp` is already overloaded).

What shipped: `CheckPlugin<Result>` (`isEnabled`/`run`/`format`/`exitCode`, optional
`jsonUnsupportedMessage`/`stamp`) plus a generic runner, with `links`/`refs`/`proseRefs`/
`coverage` migrated onto it — thin wiring only, no logic changes. `summaries` stays
hand-wired (four CLI verbs — check/stamp/prune/migrate-stamps — don't fit the shape).
No shared doc-scan context, no `dependsOn`: instead, `resolveRuleEdges` was extracted as
a pure core function (`src/core/structure/Coverage.ts`) so a future check can reuse
coverage's resolution logic directly, without a registry-level dependency mechanism.
`cli.ts`'s 4 call sites stay in their original order (not one unified loop) — console
output order and exit-code aggregation are real behavior, manually checked against the
pre-refactor binary across every flag combination during development.

Three follow-up adversarial passes (this session, after the PR was already open) each
found and closed real gaps, then flagged some as documented, out-of-scope limitations
rather than silently ignored:

- Round 1: `coveragePlugin.run` used an unguarded cast that crashed with a raw TypeError
  if ever called with coverage disabled outside the real runner — replaced with an
  explicit, clearly-named failure. The ADR's "adding a fifth check is done" claim was
  narrowed: true only for checks that reject `--json` outright — `JsonReport.ts` and
  `Config.ts`'s own per-check schema wiring are both still exactly as manual as before.
  `checks.coverage` also still has no `false`/`null` a descendant config can write to
  re-disable it once an `extends` preset turns it on, unlike `links`/`summaries`'s own
  booleans — predates this PR, not fixed here.
- Round 2: two `refsPlugin.run()` tests were tautological — asserting `checked === 0`
  against a fixture that was never stamped, provably true regardless of whether
  roots/ignore/trackedFiles were wired correctly at all; rewritten to stamp first, then
  check, and confirmed to actually fail when the wiring is deliberately broken. The
  ADR's "verified byte-for-byte against the pre-refactor binary" claim was also
  overstated — a manual, one-off terminal session, nothing checked in to reproduce it —
  narrowed to "manually checked," and the two most fragile behaviors it covered (the
  `--json` gate, the `--refs --stamp`/summaries-`--stamp` co-occurrence and ordering) are
  now `src/cli.integration.test.ts`, a real-subprocess test — the first automated test
  `cli.ts` has ever had.
- Round 3: `CheckPluginRunOutcome<Result>`'s flat `{ ran: boolean; result: Result | null
}` shape used `null` as a "didn't run" sentinel — already ambiguous with a real value
  in this codebase (`CoverageConfig | null` is a legitimately-nullable config type
  elsewhere), so a future plugin whose own `Result` could itself be `null` would have been
  silently misread as "skipped." Changed to a discriminated union
  (`{ ran: false } | { ran: true; code; lines; result: Result }`), making that
  ambiguity unrepresentable rather than merely undocumented — every `cli.ts` call site
  now narrows on `.ran` before reading the rest, enforced by the type checker. Also
  hardened `cli.integration.test.ts` itself (added in round 2, unreviewed until now): a
  subprocess launch failure (e.g. a missing `tsx` binary) now throws a clear, named error
  instead of silently returning `stdout: undefined` for a caller's `JSON.parse` to fail
  opaquely on; added the missing `--json --prose-refs` and 3-way-precedence tests its own
  `describe` title had implied were covered but weren't; switched from `npx tsx` to the
  local `node_modules/.bin/tsx` binary directly, avoiding `npx`'s own resolve step.

Two more pre-existing gaps (from #82, unrelated to the registry work itself) were found
along the way and, at the user's explicit request, fixed in this same PR rather than
just tracked: `checks.coverage` had no `false`/`null` a descendant config could write to
re-disable it once an `extends` preset turned it on — now accepts
`CoverageInputSchema | Literal(false)`, resolved via an explicit three-way check in
`layerConfig` (not a truthy check, which would silently treat `false` as "absent").
And `checks.coverage`'s kind globs are matched against absolute paths, so the README's
own relative-glob examples could never match a real scan — the matching mechanism was
already correct and consistent with `ignore`'s own `**/node_modules/**` convention; the
README's own example just didn't follow it. Fixed the README's example glob, added an
explanatory paragraph.
