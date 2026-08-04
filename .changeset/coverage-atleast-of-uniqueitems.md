---
'@sledorze/cairn': patch
---

The generated `schema/cairn.schema.json` now expresses `checks.coverage`'s `to: { atLeast: { n,
of } }` rule shape's "`of` must not contain a duplicate target" requirement STRUCTURALLY, via the
standard `uniqueItems: true` JSON Schema keyword on `atLeast.of` — closing a narrower follow-up
left open by the previous `jsonschema-crossfield-hints` release, which could only add a prose
`description` for this same constraint, not a real structural keyword. Verified against an
independent JSON Schema engine (`ajv`), not just by re-reading the generated file: a config with a
duplicate `atLeast.of` target is now rejected by editor-side JSON Schema validation, before `cairn
check` ever runs.

No decode-time accept/reject outcome changes — every config that decoded successfully before
still does, and every config `cairn check` rejected before is still rejected. The internal
enforcement mechanism did change: `atLeast.of`'s duplicate-target rejection now lives entirely in
`effect`'s own `Schema.isUnique()` (structural, key-order-insensitive comparison) rather than a
hand-rolled `JSON.stringify` compare, which also happens to fix a real latent gap in the old
check (two targets differing only in object-key order were previously, incorrectly, treated as
distinct).
