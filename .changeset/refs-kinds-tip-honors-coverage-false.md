---
'@sledorze/cairn': patch
---

`cairn check --refs`'s "Tip: configure checks.coverage.kinds..." discoverability hint now
respects `checks.coverage: false` — a repo that considered `checks.coverage.kinds` and
explicitly declined it (already a real, schema-supported value, same as every other opt-in
structure check here) no longer gets nagged on every single stale-refs report forever. Before
this, `resolved.checks.coverage` collapsed BOTH "never configured" and "explicitly declined"
to the same `null`, so there was no config-level way to silence it. New resolved field
`ChecksConfig.coverageExplicitlyDisabled` carries the distinction through; no new config
syntax, no schema change — reuses the existing `false` value.

README also corrects a factual error in `0.13.1`'s own peer-floor reasoning: it claimed
"this package has no runtime dependency on effect itself" as a blanket statement, when that's
only true for the bundled CLI. The programmatic API (`import { ... } from '@sledorze/cairn'`)
keeps real, unbundled `effect` imports and genuinely loads the consumer's installed copy at
runtime — confirmed by tracing real module resolution in a fresh pnpm sandbox
(`.pnpm/effect@.../node_modules/effect/package.json` actually opened). So for that entrypoint
an incompatible `effect` below the stated floor is a live compatibility surface, not an
untestable one — the opposite of what the prior wording implied.

Both prompted by a real REX (cairn#190).
