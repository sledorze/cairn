# Implementation details: issue #137

Concrete enough to start Release 1 from directly, building on
[`spikes.md`](./spikes.md) spike 7's working prototype; Release 2–4 sections are more
provisional, marked as such, since each depends on the prior release shipping and real
usage.

## Release 1 — declaration, validation, mandatory evidence, `covers set:published-files`

### Annotation syntax — a new fenced-block flavor, not an inline comment

Spike 1/2 found HTML comments are only PARTIALLY inert to today's checks (a link inside one
is live; a backticked path inside one is prose-ref-checked). Rather than adding comment
masking as a new primitive (which would also change what `stripCode`/`extractProseRefs` do
to every EXISTING doc using comments for other reasons — a real regression risk this design
must not accept), Release 1 uses a fenced code block with its own info string, exactly as
proven in `spikes.md` spike 7:

````
```cairn-relation
covers set:published-files [dist, schema, CHANGELOG.md]
```
````

This is masked from prose by the EXISTING `maskFencedCode` (`core/links/markdownFences.ts`)
with zero changes to that function — a fenced block with an unrecognized info string is
already invisible to `stripCode`, `extractLinks`, and `extractProseRefs` today, which is
exactly the "one annotation-stripping helper every checker reads through"
(`problem-space.md`) property Release 1 needs, for free. A new, narrow parser extracts only
` ```cairn-relation ``` ` blocks specifically (spike 7's `RELATION_FENCE_RE`), never the
generic fenced-code path other checks already use — no interference with existing code-
example fences.

### Relation grammar (Must tier — minimal, extended per predicate as Should-tier runners land)

```
<predicate> <object> [items]
```

- `predicate` — one name from a closed, small registry (Release 1 ships exactly `covers`;
  every other name in the issue's vocabulary is reserved but unimplemented, reported as an
  unknown-predicate relation error if used).
- `object` — a typed referent string, `set:<slug>` for Release 1 (`file:`/`symbol:`/
  `output:`/`command:`/`grammar:`/`claim:` are reserved, added per release below).
- `evidence` — **not yet a separate field in Release 1's minimal grammar; `covers` is
  always `evidence: checker "covers"` implicitly**, since it's the only predicate with a
  runner. The explicit `evidence: checker "<name>" | open | declined "<reason>"` field is
  required starting the moment a second predicate ships (Release 4) — deferring it for
  exactly one predicate avoids a grammar element with only one possible value, while still
  being additive (no Release 1 doc needs rewriting once the field is required).

### Core (`core/relations/` — new directory, IO-free, matches `core/` policy)

```ts
// core/relations/RelationAnnotations.ts
export interface RelationDecl {
  readonly predicate: string
  readonly object: string
  readonly items: readonly string[]
}
export const extractRelations = (content: string): readonly RelationDecl[]
```

Reuses `maskFencedCode`'s masking indirectly (the extraction regex only matches the
`cairn-relation` info string, already invisible to every OTHER check via the existing
masking) — no dependency on `MarkdownLinks.ts`'s `stripCode` needed for this module itself.

```ts
// core/relations/CoversSet.ts — the one Release 1 runner
export interface SetSource {
  readonly kind: 'package-json-files'
  // Release 4 extends this union per new set: object; Release 1 ships exactly one.
}
export const resolveSet = (source: SetSource, packageJsonText: string): readonly string[]
export const compareCovers = (
  declared: readonly string[],
  actual: readonly string[],
): { readonly ok: boolean; readonly missingFromDoc: readonly string[]; readonly extraInDoc: readonly string[] }
```

`resolveSet`'s `package-json-files` variant parses `files` through `effect`'s `Schema` (per
this repo's `no-json-global` rule — spike 7's scratch prototype used a regex specifically
BECAUSE it was scratch code exempt from that rule; the real implementation must not carry
that shortcut over). `compareCovers` applies the non-vacuity guard from spike 8's finding:
if BOTH `declared` and `actual` are empty, that's a relation error ("nothing to compare"),
not a vacuous pass — distinct from the "declared is empty but actual has 3 items" case,
which is a genuine, reportable mismatch.

### `program/relations/CheckRelations.ts` (new plugin, mirrors `CheckFreshness.ts`'s shape)

```ts
export interface RelationsResult {
  readonly checked: number
  readonly failed: readonly RelationFailure[] // a resolved, evaluated relation that mismatched
  readonly errors: readonly RelationError[] // unknown predicate, unresolvable object, vacuous inputs
}
export const checkRelations = (args: CheckRelationsArgs): Effect.Effect<RelationsResult, never, DocsFs>
export const relationsExitCode = (result: RelationsResult): number
export const formatRelationsReport = (result: RelationsResult, options: FormatOptions): readonly string[]
export const relationsPlugin = {
  isEnabled: (resolved, cli) => resolved.checks.relations !== null && !cli.linksOnly,
  ...
} satisfies CheckPlugin<RelationsResult>
```

Follows `freshnessPlugin`'s idiom (`satisfies`, not `: CheckPlugin<...> = {...}`, per this
repo's `prefer-smart-constructor` lint). `checkRelations` needs the doc corpus (`DocsFs`,
same `Env` as every plugin except `freshnessPlugin`) plus a real read of `package.json`
(NOT `GitFs` — `package.json` is read directly via `DocsFs`, same boundary discipline
`isSafelyWithinBase` already enforces for every other check that reads a real file).

### Config (`core/Config.ts`)

```ts
const RelationsInputSchema = Schema.Struct({
  // Release 1 ships no sub-fields — presence alone is the opt-in, matching
  // checks.freshness's own "presence gates it, {} is a valid enabled config" idiom.
}).annotate({ identifier: 'CairnRelationsConfig' })
const RelationsOrDisabledSchema = Schema.Union([RelationsInputSchema, Schema.Literal(false)])
```

New key in `ChecksInputSchema`: `relations: Schema.optionalKey(RelationsOrDisabledSchema)`.
Resolved side: `relations: RelationsConfig | null` in `ChecksConfig`, `null` in
`DEFAULT_CONFIG`, a `resolveLayer` branch matching `freshness`'s (whole-object replace per
layer, not deep-merge — consistent with every other `checks.*` sub-config today).
Regenerate `schema/cairn.schema.json` (`pnpm run generate-schema`) — required by the
repo's own `config.schema.integration.test.ts` drift test.

### `.cairn/` sidecar (only if Release 1 needs freshness of its OWN — open question, see below)

**Not decided speculatively:** Release 1's `covers` runner is EVALUATED LIVE every run (it
re-reads `package.json` and re-parses the doc's own current content each time, the same way
`checkLinks` re-checks existence live rather than caching) — it needs no sidecar hash at
all, unlike `--refs`. A sidecar only becomes necessary if a FUTURE predicate needs
"compare against what was true last time," not "compare against the current declared
value" — flagged here as a real open question for whichever release first needs it, not
assumed now.

### Wiring (`cli.ts`)

Add `relationsPlugin` to `JSON_INCOMPATIBLE_PLUGINS` (relations output has no natural
`--json` shape defined yet — mark `jsonUnsupportedMessage`, matching `freshnessPlugin`'s own
treatment, revisit once a real `--json` consumer asks for relation data specifically); one
`yield* reportOutcome(yield* runCheckPlugin(relationsPlugin, pluginArgs))` line, same
pattern every other plugin already uses.

### Tests (mirroring `CheckFreshness`'s and `CheckProseRefs`'s own trios)

- `RelationAnnotations.unit.test.ts` — extraction from a fenced block; a block with an
  unknown predicate name; a malformed body (missing brackets); a relation embedded inside
  an ORDINARY code-example fence with a different info string is never matched (negative
  test, matching `AGENTS.md`'s "content-mutation safety" discipline: this parser must be
  scoped structurally to `cairn-relation`-tagged fences only, never any fence containing
  similar-looking text).
- `CoversSet.unit.test.ts` — matches; missing-from-doc; extra-in-doc; the vacuity-guard case
  (both empty) reported as an error, not a pass — RED-before-GREEN against spike 8's own
  finding (temporarily remove the guard, confirm the test fails for the right reason, restore).
- `CheckRelations.plugin.unit.test.ts` — the descriptor-contract trio template
  (`CheckProseRefs.plugin.unit.test.ts`'s own shape): `isEnabled` default off/on, `name`,
  `format` delegates, `run` wiring.
- `CheckRelations.integration.test.ts` — real disk via `makeTempProject`, reconstructing
  spike 7's exact before/after/fixed sequence as a permanent regression test, per
  `AGENTS.md`'s "convert every manual dogfooding proof into a permanent test."

## Release 2 — `symbol:path#Name` objects (provisional — implementation TBD pending Release 1 + ADR amendment)

Reuses `101-refs-symbol-scoping/spikes.md` spike 4's `typescript/unstable/ast` scanner
primitive as-is (already validated standalone, no new dependency risk beyond what ADR 0004
Release 2 already accepts) — extracted, per that document's own cross-cutting risk note,
behind one narrow `extractExportRanges` interface so both `--refs` (if ADR 0004 Release 2
ships first) and `CheckRelations.ts` share ONE implementation, not two independent copies.
**Sequencing question, not resolved here:** whether typed relations' `symbol:` resolution
is built on TOP of ADR 0004 Release 2's extractor once it exists, or built first and ADR
0004 Release 2 adopts it — either order works technically; `roadmap.md`'s trigger condition
(real usage showing coarser granularity insufficient) decides which lands first in
practice.

## Release 3 — modality-grouped reporting (provisional)

`formatRelationsReport` groups by a `modalityOf(predicate)` pure function
(`core/relations/Modality.ts`) — a lookup table from predicate name to `'decidable' |
'refutable-only' | 'undecidable'`, matching the issue's own three-way split, NEVER a field
an author can set (the issue's own load-bearing rule, restated as a code-level guarantee:
`RelationDecl` carries no `modality` field at all, so there is nothing to author).

## Release 4 — next Should-tier predicate (provisional, unscoped by design)

Deferred by `roadmap.md`'s own reasoning — the SPECIFIC next predicate is chosen from real
`evidence: open` relations accumulating in this repo's own docs, not pre-selected here.
Whichever ships, it must apply spike 8's vacuity guard to its own comparison shape and add
its own before/after integration test, mirroring Release 1's trio exactly.

## Cross-cutting risks (apply to all releases)

- **The annotation-stripping/masking discipline must stay centralized.** Every relation
  runner reads doc content through the SAME extraction path (`extractRelations`, itself
  built on the existing `maskFencedCode`) — no runner should hand-roll its own fence
  detection, the same "one shared definition" principle
  `101-refs-symbol-scoping/implementation-details.md` states for its own export extractor.
- **The self-refutation hazard applies to every FUTURE predicate, not just `covers`.**
  Spike 4's fix (reference by slug, strip annotations before evaluating) is structural here
  because the annotation lives in its own fence, never in the prose a `neverClaims`/`covers`
  predicate would read — but a future predicate whose object is `claim:slug` (quoting
  ANOTHER doc's prose) must independently confirm it never reads the SOURCE doc's own
  `cairn-relation` fences as part of the content being evaluated.
- **No release here executes arbitrary project code** — every runner operates on
  already-available doc content, `package.json`, or (Release 2+) source text already read
  for another purpose; matches the issue's own explicit "Won't" scope.
