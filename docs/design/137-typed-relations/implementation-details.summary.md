# Implementation details (issue #137) — summary

**Release 1, concrete:** a new fenced-block annotation, ` ```cairn-relation ``` ` (not an
inline HTML comment — spikes 1/2 found comments only partially inert to existing checks),
masked for free by the existing `maskFencedCode`. New `core/relations/` (IO-free):
`RelationAnnotations.ts` (extraction), `CoversSet.ts` (the one Release 1 runner, `Schema`-
decoded `package.json#files`, spike 8's vacuity guard applied). New
`program/relations/CheckRelations.ts`, mirroring `CheckFreshness.ts`'s `satisfies
CheckPlugin<...>` idiom. New `checks.relations` config key, presence-gated like
`checks.freshness`. No new `.cairn/` sidecar — Release 1's `covers` is evaluated live, not
cached; a sidecar is deferred until a predicate actually needs "compare to last time."
Wired into `cli.ts` exactly like every other plugin. Tests follow the established
extraction/runner/plugin/integration four-file trio, with a RED-before-GREEN pass on the
vacuity guard specifically.

**Release 2 (provisional):** `symbol:path#Name` objects reuse
`101-refs-symbol-scoping/spikes.md` spike 4's scanner primitive as-is, extracted behind one
shared interface so `--refs` and `CheckRelations` don't duplicate it.

**Release 3 (provisional):** modality is a pure lookup table keyed by predicate name —
never a field on `RelationDecl`, so there is structurally nothing for an author to set.

**Release 4 (provisional):** unscoped by design: next predicate picked from real `open`
relations, not pre-selected.

**Cross-cutting:** one shared extraction/masking path for every runner; every future
predicate re-checked against the self-refutation hazard at design time; no release executes
arbitrary project code.
