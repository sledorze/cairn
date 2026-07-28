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
output order and exit-code aggregation are real behavior, verified byte-for-byte against
the pre-refactor binary across every flag combination.

Found along the way, unrelated to this refactor: `checks.coverage`'s kind globs are
matched against absolute paths, so the README's own relative-glob examples can never
match a real scan — confirmed pre-existing on `origin/main`, flagged as a separate
follow-up, not fixed here.
