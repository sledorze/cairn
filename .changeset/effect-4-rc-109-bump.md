---
'@sledorze/cairn': minor
---

Bumps the `effect` peer dependency floor to `^4.0.0-rc.109` (from `^4.0.0-beta.100`) — a
real, narrow break in `effect` itself between those two prereleases: `SchemaError` moved
from its own top-level `effect` export to living inside `Schema` instead (`Schema.SchemaError`),
confirmed directly against both versions' own shipped type declarations, not assumed. The
previous peer range claimed compatibility with `beta.100` that this package's own CI no
longer actually tests against.

Also fixes a real bug this bump surfaced in the shipped `schema/cairn.schema.json`:
`JsonSchema.META_SCHEMA_URI_DRAFT_07` now already includes its own trailing `#` (a separate,
undocumented change in `effect`), and `scripts/generate-schema.ts` was still appending
another one — producing a malformed `"$schema": "...schema##"` URI in the generated/shipped
schema file. Fixed to use the constant directly.

Known, non-blocking, disclosed rather than silently left implicit: `@effect/platform-node`'s
own peer dependency swapped from `ioredis` to `redis` between these versions (unrelated to
anything cairn itself uses — it has no Redis-backed platform service — but a real change in
the installed dependency tree, not just cairn's own code); and a transitive peer
(`@effect/platform-node-shared`, pulled in by `@effect/platform-node`) wants `effect@^4.0.0-rc.111`
while this repo pins `effect@4.0.0-rc.109` — tolerated by pnpm's default non-strict peer
resolution today, not yet closed, since bumping further to `rc.111` surfaced new, unrelated
CLI-integration-test breakage outside this change's own scope (a real behavioral regression
between `rc.109` and `rc.111`, not investigated here).
