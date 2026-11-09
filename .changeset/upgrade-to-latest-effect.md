---
'@sledorze/cairn': minor
---

Bumps the `effect` peer dependency floor to `^4.1.2` (from `^4.0.0-rc.109`) — the first stable
`effect@4.x` release line, off the `rc` track this package previously tracked.

A hard, transitive consequence: every stable `@effect/vitest` release compatible with stable
`effect` (`4.0.0` through at least `4.1.2`) requires `vitest >=5.0.0 <6.0.0` as a peer — the
`4.0.0-rc.112` version this package's devDependencies previously pinned was the last one still
compatible with `vitest@4.x`. There is no way to move onto stable `effect` without also moving
onto `vitest@5`, which this package's own test suite now does too.

Two real, narrow breaks `effect@4.1.2` itself introduced, both fixed here:

- `effect/cli`'s `Flag` module renamed every flag-kind constructor to capitalized form
  (`Flag.string` → `Flag.String`, `Flag.boolean` → `Flag.Boolean`, `Flag.integer` → `Flag.Int`,
  `Flag.choice` → `Flag.Literals`), and moved from `effect/unstable/cli` to `effect/cli`.
  `effect/unstable/process`'s `ChildProcess`/`ChildProcessSpawner` moved to `effect/process`.
- `Schema.toJsonSchemaDocument`'s `onExcessProperty` option now defaults to `"ignore"` (previously
  always matched a `Schema.Struct`'s own closed shape). Left at its new default, regenerating
  `schema/cairn.schema.json` would have silently flipped every `additionalProperties: false` to
  `true` — loosening the shipped schema out of step with the real, still-strict runtime decoder
  (`core/Config.ts`'s own `Schema.decodeUnknownResult(CairnConfigSchema, { onExcessProperty:
'error' })`). `scripts/generate-schema.ts` now passes the matching `{ onExcessProperty: 'error'
}` explicitly so the shipped schema keeps rejecting unknown config keys, same as before.

Also, vitest 5's default per-file test isolation (a fresh forked worker per test file) turned out
to be a real, measured 24x wall-clock regression on this repo's own suite (877s vs. ~36s under
vitest 4, confirmed by direct before/after timing) — and, under the resulting CPU contention,
spuriously failed several of this repo's own wall-clock ReDoS perf-regression guards by 6x+ their
threshold with no actual logic regression. `vitest.config.ts` now sets `isolate: false` (this
repo's tests don't rely on process-level isolation between files), restoring both the original
run time and those guards' reliability. Internal to this package's own dev/test setup — no effect
on anything shipped to consumers.
