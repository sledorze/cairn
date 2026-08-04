---
'@sledorze/cairn': minor
---

`checks.coverage`'s rule `to` field now accepts an ARRAY of targets, satisfied by a link matching ANY ONE of them — alternation/OR, additive alongside the existing single-target shape:

```json
{ "from": "roadmap", "to": ["spikes", "external-evidence"] }
```

The rule above is satisfied by a `roadmap` doc linking to EITHER a `spikes`-kind doc OR an `external-evidence`-kind doc — either one is enough. An array `to` can mix a declared kind id with `{ external: "path" }` and/or `{ external: "url", pattern }` targets, e.g. `["decision", { "external": "url", "pattern": "https://github.com/OWNER/REPO/issues/" }]`.

`scope: "sibling"` / `scope: { under: "..." }` still apply per kind-target alternative; every kind alternative is still orphan-checkable, not just the first. The missing-coverage report gets a dedicated line for an array `to`: `no link to ANY of: a "spikes"-kind doc, or a link matching "..." (required by kind "roadmap")`.

A plain (non-array) `to` — every config written before this shipped — keeps decoding and behaving exactly as before; this is purely additive.

Not included: general N-of-M cardinality (e.g. "at least 2 of these 3 alternatives must be linked"). Only "at least one of N" (OR/alternation) is expressed today — a real, narrower, still-open gap, recorded in `docs/design/CONVENTION.md`/`docs/design/review-prompts.md` rather than claimed closed.
