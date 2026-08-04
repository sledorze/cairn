---
'@sledorze/cairn': patch
---

The generated `schema/cairn.schema.json` now surfaces a prose `description` for every
cross-field/cross-element constraint `checks.coverage` enforces at config-decode time but
that plain JSON Schema cannot express structurally: an array `to`'s non-empty requirement,
`{ atLeast: { n, of } }`'s `n`/`of` relationship (non-empty, no duplicate target, `n` not
exceeding `of.length`), `scope: { under }`'s non-empty-after-trim requirement, and the
top-level rule's undeclared-kind-id / description-mandatory-when-named checks.

This does not add structural validation an editor's own JSON Schema tooling can enforce
before `cairn check` runs — investigated directly against `effect`'s
`Schema.toJsonSchemaDocument`, this is a genuine limit of plain JSON Schema for an
arbitrary cross-field predicate, not something this release works around. It does mean an
editor's autocomplete/tooltip can now at least explain the rule in prose instead of showing
nothing at all for these fields. No decode-time behavior changes — every config that
decoded successfully before still does, with the exact same accept/reject outcome.
