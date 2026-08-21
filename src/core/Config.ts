// The config domain: shape, defaults, strict decode, and layering — pure decision
// logic, no IO. The impure edge (`../config.ts`) reads `.cairnrc(.json)` /
// `package.json`'s `cairn` key from disk and hands the raw JSON here.
//
// `CairnConfigSchema` is the single source of truth for: (1) the strict per-layer
// decode below, and (2) the JSON Schema shipped for editor autocomplete
// (`scripts/generate-schema.ts` -> `schema/cairn.schema.json`, via `Schema.toJsonSchemaDocument`).
// Every field is optional (a config file only specifies what it overrides), but
// unknown keys and wrong-typed values are rejected with a clear, actionable error —
// never silently ignored. A config system that quietly falls back to defaults on a
// typo would undermine cairn's own thesis: it's a CI *guarantee*, and a guarantee
// that silently checks the wrong thing isn't one.
//
// This module uses `effect`'s `Schema`/`Result` — pure, synchronous,
// side-effect-free combinators (unlike `Effect`/`Layer`/`Runtime`, which represent
// the effectful, scheduled part of the library) — so it stays within `core/`'s "no
// IO" contract despite depending on `effect`. `Schema.SchemaError` (the decode-error
// type `decodeConfig` returns), not a top-level `effect` export `SchemaError` — a
// real, narrow break between beta.102 and rc.109: `SchemaAST`/`SchemaIssue`/
// `SchemaParser`/... were ALREADY separate root exports in beta.102, same as now
// (verified directly against beta.102's own shipped `index.d.ts`, not assumed) — only
// `SchemaError` itself moved, from its own top-level `effect` export
// (`export * as SchemaError from "./SchemaError.ts"` in beta.102) to living inside
// `Schema` instead, confirmed directly against rc.109's own `Schema.d.ts`
// (`export declare class SchemaError extends ...`).

import type { Result } from 'effect'
import { Schema, SchemaGetter } from 'effect'

import type { KindDef } from './structure/DocMetadata.ts'
import type { Naming } from './summaries/DocSummaries.ts'
import { DEFAULT_NAMING, DEFAULT_THRESHOLD_LINES } from './summaries/DocSummaries.ts'

// Every cross-field/cross-element `Schema.makeFilter` in this file (the `to`
// array's non-empty check, `atLeast`'s `n <= of.length`/no-duplicate check,
// `under`'s non-empty-after-trim check, and `CoverageInputSchema`'s own
// undeclared-kind/description-mandatory check below) enforces a constraint
// `Schema.toJsonSchemaDocument` (`scripts/generate-schema.ts`) cannot express
// STRUCTURALLY — investigated for real against `effect@4.0.0-beta.102`'s own
// source (`internal/schema/toJsonSchemaDocument.ts`'s `compileCheck`): a
// `Schema.Filter` with no `toJsonSchema` annotation callback is silently
// dropped from the generated JSON Schema entirely (`if (check._tag ===
// "Filter") return undefined`), which is the gap `docs/design/CONVENTION.md`
// previously described only vaguely ("pre-existing, not newly introduced").
// What IS real and available, confirmed by reading `compileCheck` and
// proving it with a standalone `Schema.toJsonSchemaDocument` run: a filter
// carrying a `toJsonSchema` callback — even a no-op `() => ({})` — makes
// `compileCheck` take its OTHER branch, which also merges in
// `collectJsonSchemaAnnotations(annotations, ...)` — and THAT function does
// read a plain `description` string. The result is an `allOf: [{
// description: "..." }]` fragment attached to the surrounding struct/array,
// which an editor's JSON Schema tooltip renders as prose — not a structural
// guarantee (no editor can flag the violation before `cairn check` runs),
// but a real, honest improvement over total silence. This helper is the one
// place that pattern is applied, so every cross-field check gets the same
// treatment rather than each call site reinventing the no-op callback.
const jsonSchemaHint = (description: string): Schema.Annotations.Filter => ({
  description,
  toJsonSchema: () => ({}),
})

// `by: 'path'` (glob-only) or `by: 'frontmatter'` (a flat YAML frontmatter
// field/value match) — see `KindSelector`'s own comment in
// `../structure/DocMetadata.ts` for why `by: 'frontmatter'` was added: this
// repo's own ADRs (`docs/adr/*.md`) all share one path glob but carry a real
// structural distinction (`status: proposed` vs `status: accepted`) that
// path alone can't express. Adding a further variant later (`by: 'any'`) is
// a new `Schema.Struct` branch in this `Schema.Union`, not a breaking change
// to configs already written with `by: 'path'` or `by: 'frontmatter'`.
const KindSelectorInputSchema = Schema.Union([
  Schema.Struct({
    by: Schema.Literal('path'),
    glob: Schema.String,
  }).annotate({ identifier: 'CairnKindSelectorByPath' }),
  Schema.Struct({
    by: Schema.Literal('frontmatter'),
    equals: Schema.String.annotate({
      description: 'The exact string value `field` must equal for this selector to match.',
    }),
    field: Schema.String.annotate({ description: 'The frontmatter key to read, e.g. "status".' }),
  }).annotate({ identifier: 'CairnKindSelectorByFrontmatter' }),
]).annotate({
  description:
    'How a doc is classified into a kind: `by: "path"` (glob) or `by: "frontmatter"` (a flat YAML frontmatter field must equal a value).',
  identifier: 'CairnKindSelector',
})

const KindDefInputSchema = Schema.Struct({
  // Mandatory, not optional: a kind id like `design-package` isn't
  // self-explanatory to a reader unfamiliar with this repo's own
  // convention — same "words should guide, not just label" principle
  // `CoverageRule.description` was added for (see that field's own
  // comment). Unlike a rule's `description` (mandatory only when `name` is
  // set, since an unnamed rule's auto-generated report line is already
  // self-explanatory), a KIND has no such fallback — its id is the only
  // thing that ever names it, so this is unconditionally required.
  description: Schema.String.annotate({
    description: 'What this kind actually means — shown alongside its id wherever it appears in a report.',
  }),
  id: Schema.String,
  select: KindSelectorInputSchema,
}).annotate({ description: 'One named document kind.', identifier: 'CairnKindDef' })

// `by: Schema.Literal('link')` — a single-variant discriminated union today,
// deliberately, matching `KindSelector`'s own reasoning above: WHAT it means
// for a rule to be satisfied (today: a direct outbound reference) is a fact
// about the rule, not just an implementation detail of
// `../program/structure/CheckCoverage.ts` — encoding it as a field with room
// for future variants (e.g. a minimum link count, a backlink, a
// heading-scoped reference) means a later increment adds a `Schema.Literal`
// branch, not a breaking change to `CoverageRule`'s shape. Optional (unlike
// `select`, which is required): every rule written before this field existed
// already means `by: 'link'`, so omitting it must keep decoding the same
// config the same way.
const CoverageRequirementInputSchema = Schema.Struct({
  by: Schema.Literal('link'),
}).annotate({
  description: 'How a rule is satisfied. Only `by: "link"` (a direct outbound reference) today.',
  identifier: 'CairnCoverageRequirement',
})

// `to` is either a declared kind id (a doc-kind target, the original shape),
// `{ external: 'path' }` — issue #28's third v1 check, doc→code reference
// resolution: the rule is satisfied by a link that resolves to a REAL FILE
// on disk, not to another scanned/kind-classified doc — or `{ external:
// 'url', pattern }`, added for a real, previously self-reported gap (docs/
// design/CONVENTION.md, docs/adr/0005): nothing could require a link to an
// EXTERNAL URL (e.g. a GitHub issue), only to a scanned doc or a real file.
// Satisfied by a doc's outbound link whose raw href CONTAINS `pattern` —
// deliberately a plain substring match, not a regex/glob DSL: the only
// real-world use found so far (`https://github.com/OWNER/REPO/issues/`) is
// fully expressed by "starts with" for a well-formed URL, and a substring
// match subsumes that with no separate `startsWith` variant to maintain.
// Each `external` value is a new union branch, not a breaking change to
// `CoverageRule`'s shape — existing `{ external: 'path' }` configs decode
// and behave identically.
const CoverageTargetInputSchema = Schema.Union([
  Schema.String,
  Schema.Struct({ external: Schema.Literal('path') }),
  Schema.Struct({
    external: Schema.Literal('url'),
    pattern: Schema.String.annotate({
      description:
        'A plain substring a satisfying link\'s raw href must contain, e.g. "https://github.com/OWNER/REPO/issues/". No regex/glob — a literal substring match.',
    }),
  }),
]).annotate({
  description:
    'A declared kind id (a doc-kind target), `{ external: "path" }` — a link must resolve to a real file on disk, not to a scanned doc — or `{ external: "url", pattern }` — a link\'s raw href must contain `pattern`.',
  identifier: 'CairnCoverageTarget',
})

// `CoverageRule.to` was a single `CoverageTarget` (satisfied by ANY ONE
// matching link — its own natural "at least one" meaning) until this
// variant: `CONVENTION.md`'s "Judging this convention" Claim 2 named a real
// gap, closed here — `CoverageRequirement.by` had no N-of-M/alternation
// construct, so a doc that should satisfy a rule by linking to EITHER a
// `spikes`-kind doc OR an `external-evidence`-kind doc had no way to say
// so; two separate rules on the same `from` are always AND'd, never OR'd.
// Rather than growing `CoverageRequirement.by` a new variant (which would
// still need a NEW field naming which OTHER rule it alternates with, a much
// bigger shape change), the minimal fix is here, on `to` itself: a rule
// with `to` as an ARRAY of targets is satisfied by a link matching ANY ONE
// of them — the same "at least one" semantics a single target already had,
// just widened over a set. Purely additive: the plain, non-array
// `CoverageTargetInputSchema` shape (first union member, unchanged) keeps
// decoding and behaving exactly as it did — every existing single-`to`
// config is unaffected. See `targetsOf` (below) for the one place every
// consumer normalises `to` into a uniform list, and
// `../structure/Coverage.ts`'s `matchNode` for the actual OR-satisfaction
// resolution.
// Extracted to a named function (not inlined into the `Schema.check`),
// matching `checkUnderNotEmpty`'s own precedent just above — purely to keep
// call nesting within oxlint's `max-nested-calls`, no behavior difference.
const checkToArrayNotEmpty = (targets: readonly unknown[]): string | undefined =>
  targets.length === 0
    ? "`to` must not be an empty array — a rule with zero alternatives can never be satisfied, the same permanently-unsatisfiable trap an out-of-scope `under` falls into (see `ScopeUnderPathSchema`'s own comment)"
    : undefined

const toArrayNotEmptyFilter = Schema.makeFilter(
  checkToArrayNotEmpty,
  jsonSchemaHint(
    "An array `to` must be non-empty — a rule with zero alternatives can never be satisfied. Enforced at decode time; not visible here as a structural `minItems`, see `jsonSchemaHint`'s own comment for why.",
  ),
)

// `{ any: [...] }` — the explicit, named form of the bare-array alternation
// shape just above (`to: ['spikes', 'evidence']`). Added alongside the new
// `atLeast` variant below purely for naming symmetry — once a rule can also
// say "at least N of these," a reader benefits from an explicit "any of
// these" counterpart instead of a bare array meaning one thing and a
// labelled object meaning another. Deliberately NOT a replacement for the
// bare array: that shape already shipped (docs/design/CONVENTION.md, docs/
// design/review-findings.md section 3) and every config written against it
// must keep decoding and behaving exactly as it did — `to: [...]` and
// `to: { any: [...] }` are two spellings of the identical "at least one of
// these" semantics, both supported, neither deprecated.
const AnyTargetInputSchema = Schema.Struct({
  any: Schema.Array(CoverageTargetInputSchema).pipe(Schema.check(toArrayNotEmptyFilter)),
}).annotate({
  description:
    "The explicit, named form of a bare-array `to` — satisfied by a link matching ANY ONE of `any`'s targets (alternation/OR). Equivalent to `to: [...]`, not a replacement for it.",
  identifier: 'CairnCoverageTargetAny',
})

// `{ atLeast: { n, of } }` — the still-open half of the N-of-M/alternation
// gap `docs/design/CONVENTION.md`'s "Judging this convention" Claim 2 and
// `docs/design/review-findings.md` section 3 both named and left unclosed:
// the bare-array/`any` shape only ever expresses "at least ONE of these";
// nothing could express "at least N of these" for N > 1, nor an explicit
// "every one of these" distinct from N separately-AND'd rules on the same
// `from`. `atLeast` closes the general case: `n` targets, `of` a candidate
// list — satisfied when at least `n` of `of`'s elements EACH have their own
// satisfying link (not `n` total links to the SAME element). Requiring
// "all" is just `atLeast: { n: of.length, of }` — no separate `all` variant
// needed, matching this repo's own minimal-surface discipline (`AGENTS.md`:
// don't add an abstraction the schema doesn't need). Validated at decode
// time, not left to silently misbehave: `n` must be a positive integer
// (`n: 0` would be vacuously satisfied by nothing — the same "silently
// matches everything" failure class `ScopeUnderPathSchema`'s own empty-
// `under` check exists to catch, just satisfied-by-default instead of
// scoped-to-everything) and must not exceed `of.length` (a higher `n` could
// never be satisfied, the same permanently-unsatisfiable trap an empty `to`
// array already falls into).
//
// Adversarial self-review, before this shipped (this task's own Part D):
// `of` containing a DUPLICATE target (e.g. `of: ['spikes', 'spikes']`) lets
// ONE real satisfying link count toward the minimum TWICE — `../structure/
// Coverage.ts`'s `countSatisfiedTargets` checks each `of` index
// independently, so two identical entries both register as "satisfied" the
// moment a single link matches either one. Proved concretely, not just
// reasoned: `resolveRuleEdges({ rules: [{ from: 'roadmap', to: { atLeast: {
// n: 2, of: ['spikes', 'spikes'] } } }] })` against a doc with exactly ONE
// link to a `spikes`-kind doc came back `satisfied: true` before a
// duplicate-target check existed — the exact "silently requires fewer
// DISTINCT things than `n` implies" failure class this whole feature exists
// to prevent, now nearly shipped by the feature meant to prevent it.
//
// The duplicate-target rejection itself now lives entirely on `of`'s own
// field-level `atLeastOfUniqueFilter` (`Schema.isUnique()`, below) rather
// than here — a later round (`docs/design/review-findings.md` section 7)
// investigated adding `Schema.isUnique()` purely for its `uniqueItems: true`
// JSON-Schema-discoverability side effect, and in doing so discovered, by
// construction (not assumed), that it actually SUBSUMES this function's own
// original `JSON.stringify`-based duplicate check for every real
// `CoverageTarget` shape: `effect`'s `Equal.equals` (what `Schema.isUnique()`
// uses under `Arr.dedupe`) does STRUCTURAL, key-order-INSENSITIVE comparison
// for plain objects — confirmed directly (`Equal.equals({ external: 'url',
// pattern: 'x' }, { pattern: 'x', external: 'url' })` returns `true`, while
// `JSON.stringify` of the same pair differs) — which is a STRICT SUPERSET of
// what `JSON.stringify` equality can ever catch (anything `JSON.stringify`-
// equal is necessarily also `Equal.equals`-equal, since identical key order
// is one case of "any order"). Combined with field-level checks running
// BEFORE a struct's own cross-field check in this schema library (confirmed
// the same way: decoding `{ atLeast: { n: 2, of: ['spikes', 'spikes'] } }`
// surfaces `Schema.isUnique()`'s own "Expected an array with unique items"
// message, never reaching this function at all), this function's own
// duplicate-target branch became permanently unreachable dead code the
// moment `atLeastOfUniqueFilter` was added — removed here rather than kept
// as inert, misleading "defense in depth" (this repo's own coverage
// threshold ratchet caught the resulting 0%-covered branch for real; kept
// would have meant either accepting a coverage regression or writing a test
// that could never legitimately exercise it).
const checkAtLeastSane = (v: { readonly n: number; readonly of: readonly unknown[] }): string | undefined => {
  if (v.of.length === 0) {
    return '`atLeast.of` must not be an empty array — the same permanently-unsatisfiable trap a bare empty `to` array falls into'
  }
  if (v.n > v.of.length) {
    return `\`atLeast.n\` (${v.n}) must not exceed \`atLeast.of.length\` (${v.of.length}) — a rule requiring more targets than are listed can never be satisfied`
  }
  return undefined
}

const atLeastSaneFilter = Schema.makeFilter(
  checkAtLeastSane,
  jsonSchemaHint(
    "`atLeast.of` must be non-empty, and `atLeast.n` must not exceed `atLeast.of.length` — cross-field constraints between `n` and `of` that JSON Schema cannot express structurally. Enforced at decode time; see `jsonSchemaHint`'s own comment for why this shows up only as prose here. (`atLeast.of`'s own no-duplicate-target requirement is enforced separately, on `of` itself — see that field's own `atLeastOfUniqueFilter`.)",
  ),
)

// The real, authoritative enforcement of "no duplicate target in `atLeast.of`"
// — see `checkAtLeastSane`'s own comment above for why this, not a
// `JSON.stringify` compare inside that function, is where this check now
// lives: `effect`'s built-in `Schema.isUnique()` maps directly onto the real
// `uniqueItems: true` JSON Schema keyword (confirmed via a standalone
// `Schema.toJsonSchemaDocument` probe, and via validating the real
// regenerated `schema/cairn.schema.json` with an independent JSON Schema
// engine, `ajv`, which correctly rejects a duplicate `atLeast.of` and
// accepts a clean one), so using it here closes a real JSON-Schema
// structural-discoverability gap this same field's `n <= of.length`/
// non-empty constraints still can't close, AND its `Equal.equals`-based
// structural, key-order-insensitive comparison is strictly stronger than
// the `JSON.stringify` compare it replaces. Extracted to a named const,
// matching `checkToArrayNotEmpty`/`checkUnderNotEmpty`'s own precedent
// above, purely to keep call nesting within oxlint's `max-nested-calls`
// once this filter is piped through `Schema.check(...)` below — no
// behavior difference.
const atLeastOfUniqueFilter = Schema.isUnique()

const AtLeastNSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
  description:
    'The minimum number of `atLeast.of` targets that must each independently have at least one satisfying link. A positive integer — `n: 0` would make the rule vacuously satisfied by nothing, defeating the point of requiring a minimum.',
})
const AtLeastOfSchema = Schema.Array(CoverageTargetInputSchema).pipe(Schema.check(atLeastOfUniqueFilter))

const AtLeastTargetInputSchema = Schema.Struct({
  atLeast: Schema.Struct({
    n: AtLeastNSchema,
    of: AtLeastOfSchema,
  }).pipe(Schema.check(atLeastSaneFilter)),
}).annotate({
  description:
    'Satisfied when at least `n` of `of`\'s targets EACH have their own satisfying link — general N-of-M cardinality, e.g. `{ atLeast: { n: 2, of: ["spikes", "external-evidence", "prior-art"] } }` requires links to at least 2 of the 3 listed kinds. "All of these" is `n: of.length`; there is no separate `all` variant.',
  identifier: 'CairnCoverageTargetAtLeast',
})

const CoverageTargetOrAlternativesInputSchema = Schema.Union([
  CoverageTargetInputSchema,
  Schema.Array(CoverageTargetInputSchema).pipe(Schema.check(toArrayNotEmptyFilter)),
  AnyTargetInputSchema,
  AtLeastTargetInputSchema,
]).annotate({
  description:
    'A single coverage target (satisfied by any one matching link); an ARRAY of targets, or the equivalent `{ any: [...] }`, satisfied by a link matching ANY ONE of them (alternation/OR, e.g. `to: ["spikes", "external-evidence"]`); or `{ atLeast: { n, of } }`, satisfied when at least `n` of `of`\'s targets EACH have a satisfying link (general N-of-M). Every array form is non-empty — see each element\'s own `CairnCoverageTarget` shape.',
  identifier: 'CairnCoverageTargetOrAlternatives',
})

// Adversarial review, before this shipped: `Coverage.ts`'s own
// `scopeSatisfied` trims leading/trailing slashes off `under` before
// building `**/${under}/**` — an `under` that trims to the EMPTY string
// (`""`, `"/"`, `"///"`, ...) collapses that glob to `**//**`, which
// matches every path in the corpus. That's silently WORSE than the
// already-disclosed "typo'd/out-of-roots `under` makes a rule permanently
// unsatisfiable" limitation (loud, missing-coverage failures) — an empty
// `under` makes the rule vacuously satisfied by ANYTHING, indistinguishable
// in a report from a real, intentional scope. Rejected at decode time, not
// left to `scopeSatisfied` to quietly misbehave. Extracted to a named
// function (not inlined into the `Schema.check`) purely to keep call
// nesting within oxlint's `max-nested-calls` — no behavior difference.
const checkUnderNotEmpty = (s: string): string | undefined =>
  s.replaceAll(/^\/+|\/+$/g, '').length === 0
    ? '`under` must not be empty, or only slashes — an empty scope would silently match every doc in the corpus, the opposite of what `scope` exists to restrict'
    : undefined

const underNotEmptyFilter = Schema.makeFilter(
  checkUnderNotEmpty,
  jsonSchemaHint(
    '`under` must not be empty, or only slashes, once leading/trailing slashes are trimmed — an empty scope would silently match every doc in the corpus.',
  ),
)

// `.annotate()` BEFORE `.pipe(Schema.check(...))`, not after: confirmed by a
// standalone `Schema.toJsonSchemaDocument` probe (see `jsonSchemaHint`'s own
// comment) that `.annotate()` chained directly after a `.check()` on the SAME
// schema node overwrites that check's own `description` annotation rather
// than adding a second, separate one — the two `description`s would
// otherwise silently collapse into whichever one is applied last, exactly
// the "one gets silently dropped" failure this whole `jsonSchemaHint` effort
// exists to avoid. Annotating first keeps both: the base-type description
// below AND `underNotEmptyFilter`'s own cross-field-adjacent hint, each in
// their own place in the generated JSON Schema (verified in
// `schema/cairn.schema.json`'s `CairnCoverageRuleScopeUnder.properties.under`).
const ScopeUnderPathSchema = Schema.String.annotate({
  description:
    'A non-empty project-relative directory path (no globs) — a rule so scoped is satisfied only by a `to`-kind doc whose resolved path is nested anywhere below this directory.',
}).pipe(Schema.check(underNotEmptyFilter))

// See `CoverageRuleInputSchema`'s own `scope` field comment for the full
// "narrower than corpus-wide, broader than sibling" motivation. A separate
// named union (matching `KindSelectorInputSchema`/`CoverageTargetInputSchema`'s
// own shape) rather than an inline literal, on purpose: `scripts/
// coverage-metrics.ts`'s schema variant census extracts and counts each of
// these three named unions the same way, so a scope variant that isn't its
// own named declaration would silently stop being counted.
const CoverageRuleScopeInputSchema = Schema.Union([
  Schema.Literal('sibling'),
  Schema.Struct({
    under: ScopeUnderPathSchema,
  }).annotate({ identifier: 'CairnCoverageRuleScopeUnder' }),
]).annotate({
  description: 'How a rule\'s satisfaction is scoped: `"sibling"`, `{ under: "some/dir" }`, or omitted (corpus-wide).',
  identifier: 'CairnCoverageRuleScope',
})

const CoverageRuleInputSchema = Schema.Struct({
  // Found refuting whether this schema's own vocabulary (`name` values like
  // `grounded_by`/`builds_on`/`derived_from` — see docs/design/CONVENTION.md's
  // reference list) actually GUIDES anyone: `name` alone only ever fed a
  // disambiguating label into the report (`no link ("grounded_by") to a
  // "spikes"-kind doc`) — a reader hitting that with no prior context has no
  // way to know what "grounded_by" MEANS or how to fix it without separately
  // finding and reading CONVENTION.md. `description` is real, in-context
  // guidance rendered directly in `formatCoverageReport` (../../program/
  // structure/CheckCoverage.ts) alongside the bare label, closing that gap
  // for real rather than leaving the vocabulary as config-only metadata.
  // Structurally optional (a plain, unnamed rule's report line is already
  // self-explanatory — see `CoverageInputSchema`'s own cross-field check
  // below), but MANDATORY whenever `name` is set, enforced there, not just
  // documented here: a named rule with no description silently reintroduces
  // the exact gap this field exists to close.
  description: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Human-readable guidance shown in the report when this rule is unmet — what the relationship means and how to satisfy it, not just its name. Mandatory whenever `name` is set.',
    }),
  ),
  from: Schema.String,
  // Optional discriminant, not just documentation: two rules sharing the
  // same (from, to) pair but different meanings (e.g. issue #28's own
  // `implements` vs `verified_by` between the same two kinds) are DISTINCT
  // obligations, not the same rule twice — `name` is what tells them apart
  // for deduplication (../program/structure/CheckCoverage.ts) and in report
  // output. Two rules on the same pair with no name (or the same name)
  // still dedupe as one — there'd be no way to tell them apart otherwise.
  name: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Distinguishes this rule from another sharing the same from/to pair (e.g. "implements" vs "verified_by"). Two rules on the same pair with no name, or the same name, are treated as one.',
    }),
  ),
  // Issue found dogfooding checks.coverage itself for structural design-
  // package completeness (docs/design/CONVENTION.md): a WILDCARD kind glob
  // (`**/docs/design/*/spikes.md`, matching every package) lets a `from` doc
  // in one package satisfy its rule by linking to a DIFFERENT package's `to`
  // doc — real, verified capturability, not theoretical (a fully hollow
  // package cross-linking a real sibling's docs passed with zero warnings).
  // The only fix that didn't require per-package config duplication (a
  // separately-confirmed real cost: `.cairnrc.json` growing without bound as
  // packages accumulate, one hand-copied kind/rule block per package) is
  // this: `scope: 'sibling'` restricts satisfaction to a `to`-kind doc in
  // the EXACT SAME parent directory as the `from` doc, so one wildcard-glob
  // kind pair works correctly for every package at once, present and future,
  // with zero additional config per package. Optional, defaulting to
  // today's unscoped ("anywhere in the corpus") behavior — existing configs
  // written before this field existed keep meaning exactly what they did.
  //
  // `{ under: '...' }` (docs/design/CONVENTION.md's "Judging this
  // convention" Claim 2, re-confirmed in docs/adr/0005's amendments): a real
  // gap sat BETWEEN `'sibling'` (exact same directory — too narrow for a
  // rule that should span a whole named sub-tree, e.g. every package under
  // `docs/design/team-b/`) and the unscoped default (anywhere in the
  // corpus — too broad, the original capturability hole `scope` exists to
  // close in the first place). `under` is a plain project-relative directory
  // path (no glob syntax) — satisfied only by a `to`-kind doc whose resolved
  // path is nested anywhere below that directory, matched the same way a
  // kind's own `**/`-prefixed path glob already matches project-relative
  // regardless of the absolute scan root (see `Coverage.ts`'s
  // `scopeSatisfied`). Purely additive: `'sibling'` keeps decoding and
  // behaving exactly as it did.
  scope: Schema.optionalKey(
    CoverageRuleScopeInputSchema.annotate({
      description:
        '`"sibling"` restricts rule satisfaction to a `to`-kind doc in the SAME parent directory as the `from` doc. `{ under: "some/dir" }` restricts it to a `to`-kind doc nested anywhere below that project-relative directory — narrower than the unscoped corpus-wide default, broader than `"sibling"`. Omit for the default: satisfied by a `to`-kind doc anywhere in the scanned corpus.',
    }),
  ),
  to: CoverageTargetOrAlternativesInputSchema,
  via: Schema.optionalKey(CoverageRequirementInputSchema),
}).annotate({
  description:
    'Every doc of kind `from` must link somewhere to a doc of kind `to` — or, when `to` is `{ external: "path" }`, to a real file on disk, or, when `to` is `{ external: "url", pattern }`, to a URL containing `pattern`. `to` may also be an ARRAY of targets, satisfied by a link matching ANY ONE of them (alternation/OR).',
  identifier: 'CairnCoverageRule',
})

// Presence of `checks.coverage` itself IS the opt-in — no separate `enabled`
// flag: an empty `{kinds:[],rules:[]}` is legal but checks nothing, same
// shape as `roots: []` already means "nothing to scan," not a schema error.
//
// Cross-field check: every rule's `from`/`to` must name a declared kind id.
// Without this, a typo'd kind id (e.g. "decisionn") isn't a schema error —
// it's a rule that can never be satisfied, silently reporting every
// `from`-kind doc as missing coverage forever (see docs/adr/0002's
// Consequences section, which originally documented this as an accepted
// gap before it was closed here). Caught loudly at decode time instead of
// discovered by a confused user reading an always-red report.
// Cross-field check body extracted to a named function (not inlined into
// `Schema.check`) purely to keep call nesting within oxlint's
// `max-nested-calls` once this filter also needed to pass a `jsonSchemaHint`
// as its second argument — no behavior difference from when this was inline.
const checkCoverageCrossFields = (coverage: {
  readonly kinds: readonly { readonly id: string }[]
  readonly rules: readonly {
    readonly description?: string | undefined
    readonly from: string
    readonly name?: string | undefined
    readonly to: unknown
  }[]
}): readonly Schema.FilterIssue[] => {
  const declaredIds = new Set(coverage.kinds.map((k) => k.id))
  const issues: Schema.FilterIssue[] = []
  coverage.rules.forEach((rule, i) => {
    if (!declaredIds.has(rule.from)) {
      issues.push({ issue: `references undeclared kind "${rule.from}"`, path: ['rules', i, 'from'] })
    }
    // `to` names no kind at all when it's `{ external: 'path' }` — the
    // undeclared-kind check only applies to the plain kind-id string
    // shape. `to` may also be an ARRAY of alternatives, `{ any: [...] }`,
    // or `{ atLeast: { n, of } }` (see
    // `CoverageTargetOrAlternativesInputSchema`'s own comment) — every
    // element of whichever shape gets the same undeclared-kind check,
    // each pinned to its own path (including array index) so a typo in
    // one alternative doesn't read as pointing at the whole `to` field.
    const toTargetEntries: { readonly path: readonly (number | string)[]; readonly target: unknown }[] = Array.isArray(
      rule.to,
    )
      ? rule.to.map((target, j) => ({ path: ['rules', i, 'to', j], target }))
      : typeof rule.to === 'object' && rule.to !== null && 'any' in rule.to && Array.isArray(rule.to.any)
        ? rule.to.any.map((target: unknown, j: number) => ({ path: ['rules', i, 'to', 'any', j], target }))
        : typeof rule.to === 'object' &&
            rule.to !== null &&
            'atLeast' in rule.to &&
            typeof rule.to.atLeast === 'object' &&
            rule.to.atLeast !== null &&
            'of' in rule.to.atLeast &&
            Array.isArray(rule.to.atLeast.of)
          ? rule.to.atLeast.of.map((target: unknown, j: number) => ({
              path: ['rules', i, 'to', 'atLeast', 'of', j],
              target,
            }))
          : [{ path: ['rules', i, 'to'], target: rule.to }]
    toTargetEntries.forEach(({ path: targetPath, target }) => {
      if (typeof target === 'string' && !declaredIds.has(target)) {
        issues.push({
          issue: `references undeclared kind "${target}"`,
          path: targetPath,
        })
      }
    })
    // `description` is mandatory ONLY when `name` is set — deliberately
    // NOT for every rule (refuted: an unnamed rule's report line, "no
    // link to a 'X'-kind doc," is already fully self-explanatory —
    // forcing a description there produces restated filler, exactly
    // the decorative-not-genuine text this field exists to avoid). A
    // NAMED rule (e.g. `grounded_by`) uses vocabulary a reader can't
    // infer from the bare label alone — found for real: `name` only
    // ever fed a disambiguating label into the report, never
    // explained anything (see `description`'s own comment above).
    // Enforced at decode time, not left to authorial discipline, so
    // the next named rule can't silently reintroduce the exact gap
    // `description` was added to close.
    if (rule.name !== undefined && rule.description === undefined) {
      issues.push({
        issue: `named rule "${rule.name}" has no description — a bare name doesn't explain what it means to a reader`,
        path: ['rules', i, 'description'],
      })
    }
  })
  return issues
}

const coverageCrossFieldsHint = jsonSchemaHint(
  "Cross-field constraints, checked at decode time and NOT visible as JSON Schema structure: every rule's `from`/`to` must reference a declared `kinds[].id`, and a named rule (`name` set) must also carry a `description`.",
)

const CoverageInputSchema = Schema.Struct({
  exempt: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: 'Globs exempted from orphan detection — a doc matching one is never reported as orphaned.',
    }),
  ),
  kinds: Schema.Array(KindDefInputSchema),
  rules: Schema.Array(CoverageRuleInputSchema),
})
  .annotate({
    description:
      'Opt-in structural coverage/orphan check over a declared doc-kind graph. Absent by default — presence enables it.',
    identifier: 'CairnCoverageConfig',
  })
  .pipe(Schema.check(Schema.makeFilter(checkCoverageCrossFields, coverageCrossFieldsHint)))

// Issue #108: `checks.coverage` only ever asks doc→doc questions ("does a
// doc of kind X link to a doc of kind Y") — nothing checks that a SOURCE
// FILE is mentioned by any documentation at all, so a brand-new,
// undocumented module passes `cairn check` cleanly. Deliberately a SEPARATE
// key, not an extension of `CoverageInputSchema`'s `kinds`/`rules` shape —
// design review (issue #108's own thread) found that bolting "sometimes
// `kind` means a raw filesystem path, not a scanned doc" onto the existing
// engine would make the same `kinds`/`rules` array sometimes mean doc→doc,
// sometimes doc→path, distinguished only by a flag a reader has to check
// per-entry. A dedicated key keeps the two mechanisms visually and
// structurally distinct instead.
//
// `coveredBy` is a list of NAMED groups (not a single glob) because a
// source file can legitimately be documented from more than one kind of
// doc (an architecture doc, an ADR, a README) — `kind` exists purely for
// report clarity ("src/x.ts is covered by neither `architecture` nor
// `adr`"), not to drive per-kind separate obligations: coverage is
// satisfied by a link from ANY one of the listed groups, not all of them.
const DocCoverageGroupInputSchema = Schema.Struct({
  glob: Schema.String,
  kind: Schema.String,
}).annotate({
  description: 'One named group of docs whose outbound links count as covering a source file.',
  identifier: 'CairnDocCoverageGroup',
})

const DocCoverageInputSchema = Schema.Struct({
  coveredBy: Schema.Array(DocCoverageGroupInputSchema),
  exempt: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: 'Globs exempted from source-tree coverage — a source file matching one is never reported.',
    }),
  ),
  sources: Schema.Array(Schema.String),
}).annotate({
  description:
    'Opt-in check that every source file matching `sources` is linked to by at least one doc matching ' +
    'one of the `coveredBy` groups. Absent by default — presence enables it. Direct links only (a citation ' +
    "chain through an intermediate doc does not count), matching `checks.coverage`'s own non-transitive rules.",
  identifier: 'CairnDocCoverageConfig',
})

// `DocCoverageInputSchema | Literal(false)` — same escape hatch as
// `CoverageOrDisabledSchema` below, for the same reason: a descendant
// config needs a way to turn an inherited `extends` preset's docCoverage
// back off with a plain `false`, not just override it with different globs.
const DocCoverageOrDisabledSchema = Schema.Union([DocCoverageInputSchema, Schema.Literal(false)])

// The "freshness/staleness rules" gap `docs/design/CONVENTION.md`'s "Judging
// this convention" Claim 2 named and left open ("nothing in the schema
// touches dates/mtimes at all, so a 'doc must be re-validated after N
// months' freshness rule is outside its vocabulary entirely, not just
// unconfigured"). Deliberately NOT a new field on `CoverageRule` — a
// structural analysis recorded in this repo's own design docs found
// freshness is a genuinely different axis from every other `CoverageRule`
// field: TEMPORAL ("when was this doc last meaningfully touched"), not
// RELATIONAL ("does this doc link to that doc"). Bolting it onto
// `CoverageRule` would repeat the exact "one bespoke variant per round"
// growth pattern `scope`'s own "Noted-but-deferred structural observation"
// paragraph already flags as a design smell — so this is its own minimal,
// separately opt-in check instead, matching how `checks.docCoverage` itself
// is wired independently of `checks.coverage` rather than as a field
// grafted onto it.
// Extracted to a named schema (not inlined into the `Struct` field) purely
// to keep call nesting within oxlint's `max-nested-calls`, matching
// `ThresholdLinesSchema`/`AtLeastNSchema`'s own precedent just above/below
// in this file — no behavior difference.
const MaxAgeDaysSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))).annotate({
  description:
    'A doc last touched (per its git history — real content changes, not filesystem mtime) more than this ' +
    'many days ago is reported stale. A positive integer.',
})

const FreshnessRuleInputSchema = Schema.Struct({
  glob: Schema.String.annotate({
    description: 'Which docs this rule applies to. The FIRST rule (in declared order) whose glob matches a doc wins.',
  }),
  maxAgeDays: MaxAgeDaysSchema,
}).annotate({
  description:
    "One glob and its own staleness threshold. Matched against a doc's path the same two-step way every " +
    'other check in this file does (absolute, then project-relative).',
  identifier: 'CairnFreshnessRule',
})

const FreshnessInputSchema = Schema.Struct({
  rules: Schema.Array(FreshnessRuleInputSchema),
}).annotate({
  description:
    "Opt-in check that a doc's real git history is no older than its own matching rule's `maxAgeDays`. " +
    'A doc with no commit history yet is silently excluded (nothing to measure an age from), never reported ' +
    'stale or fresh. Absent by default — presence enables it.',
  identifier: 'CairnFreshnessConfig',
})

// `FreshnessInputSchema | Literal(false)` — same escape hatch as
// `CoverageOrDisabledSchema`/`DocCoverageOrDisabledSchema`, for the same
// reason: a descendant config needs a way to turn an inherited `extends`
// preset's freshness check back off with a plain `false`.
const FreshnessOrDisabledSchema = Schema.Union([FreshnessInputSchema, Schema.Literal(false)])

// A real, live drift this repo found in its OWN docs: every `docs/design/*/story-map.md`
// carries a `## Walking skeleton (the line above marks it in each column)` heading
// claiming a marked walking-skeleton card exists per backbone step, but none of the three
// actually had exactly one `(Must)`-tagged card per step (two had zero MoSCoW tags at
// all) — see `../structure/StoryMapTiers.ts`'s own header for the full finding. Kept to a
// single `globs` field, not a configurable heading-pattern/tier-vocabulary system: this
// repo has exactly one real convention for what a backbone/tier-tagged doc looks like (one
// `## Cards, by backbone step` shape, one `(Must|Should|Could)` vocabulary, shared
// verbatim across all 3 existing story-maps) — building configurability against a single
// data point would be the same premature generality `137-typed-relations/roadmap.md`'s own
// Release 0 already declined for the harder, general typed-relations problem.
const StoryMapTiersInputSchema = Schema.Struct({
  globs: Schema.Array(Schema.String).annotate({
    description: 'Which docs to check for the walking-skeleton invariant (one `(Must)`-tagged card per backbone step).',
  }),
}).annotate({
  description:
    "Opt-in check that every backbone step under a story-map's `## Cards, by backbone step` section has " +
    'exactly one `(Must)`-tagged card — the thinnest complete slice at that step. Absent by default — ' +
    'presence enables it.',
  identifier: 'CairnStoryMapTiersConfig',
})

// `StoryMapTiersInputSchema | Literal(false)` — same escape hatch as
// `FreshnessOrDisabledSchema` above, for the same reason: a descendant config needs a way
// to turn an inherited `extends` preset's storyMapTiers check back off with a plain
// `false`.
const StoryMapTiersOrDisabledSchema = Schema.Union([StoryMapTiersInputSchema, Schema.Literal(false)])

// `CoverageInputSchema | Literal(false)`, not just `CoverageInputSchema` —
// `links`/`summaries` can be turned back off with a plain `false`, letting a
// descendant config override an inherited `extends` preset; `checks.coverage`
// needs the same escape hatch (a real, found-via-adversarial-review gap:
// once a preset enabled coverage, no descendant config had any way to
// disable it again short of replacing `kinds`/`rules` with empty arrays,
// which still leaves `isEnabled` true, just vacuously). Resolves to `null`
// (the same "disabled" value omitting the key entirely produces at the
// base config) in `layerConfig`, below.
const CoverageOrDisabledSchema = Schema.Union([CoverageInputSchema, Schema.Literal(false)])

// REX feedback (dogfooding, issue-tracked as a real false-positive report):
// a doc that itself documents a path FORMAT — a table of sample paths, a
// prose example naming a fictitious filename — has no way to write that
// example without `--prose-refs` treating it as a real citation to verify.
// `ignore` here is the config-level escape hatch: exact backticked text (or
// a glob over it) that's always illustrative, never a citation, matched
// before existence is ever checked — same shape as the top-level `ignore`
// field already uses for excluding files from scanning, applied instead to
// the cited TEXT itself.
const ProseRefsInputSchema = Schema.Struct({
  ignore: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'Backticked prose citations (exact text, or a glob over it) to always treat as illustrative — never ' +
        'checked for existence, same as a citation that already resolves. For a path-shaped example in a format ' +
        'table or a case study using a fictitious filename, not for excluding real, resolvable citations. ' +
        'Matched against the literal backticked text (e.g. `src/a.ts`), not a filesystem path.',
    }),
  ),
}).annotate({
  description:
    'Tuning for `--prose-refs` (a CLI-flag opt-in check; this config section only tunes it, it does not enable ' +
    'it — absent means no ignore list, not disabled).',
  identifier: 'CairnProseRefsConfig',
})

// Issue #101 / ADR 0004 Release 1: first-match-wins (array order), same
// semantics `docCoverage.sources`/`coveredBy` glob matching already uses via
// `matchesGlobNearBase` — "which ONE group does this target belong to," not
// `checks.docCoverage`'s OR-across-all-groups question. No match keeps
// today's only behavior: `whole-file`.
const RefsScopeGroupInputSchema = Schema.Struct({
  glob: Schema.String,
  unit: Schema.Literals(['whole-file', 'ignore']), // Release 2 adds 'exports-only' here
}).annotate({
  description: 'One glob and the granularity `--refs` uses for content matching it.',
  identifier: 'CairnRefsScopeGroup',
})

const RefsInputSchema = Schema.Struct({
  scope: Schema.optionalKey(Schema.Array(RefsScopeGroupInputSchema)),
}).annotate({
  description:
    'Tuning for `--refs` (a CLI-flag opt-in check; this config section only tunes it, it does not enable it — ' +
    'absent means no scope overrides, every target hashed whole-file).',
  identifier: 'CairnRefsConfig',
})

const ChecksInputSchema = Schema.Struct({
  coverage: Schema.optionalKey(CoverageOrDisabledSchema),
  docCoverage: Schema.optionalKey(DocCoverageOrDisabledSchema),
  freshness: Schema.optionalKey(FreshnessOrDisabledSchema),
  links: Schema.optionalKey(
    Schema.Boolean.annotate({ description: 'Enable Markdown dead-link checking. Default true.' }),
  ),
  proseRefs: Schema.optionalKey(ProseRefsInputSchema),
  storyMapTiers: Schema.optionalKey(StoryMapTiersOrDisabledSchema),
  summaries: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'Enable summary freshness checking (content-hash based). Default true.',
    }),
  ),
}).annotate({ description: 'Which checks `cairn check` runs.', identifier: 'CairnChecksConfig' })

const NamingInputSchema = Schema.Struct({
  dirSummary: Schema.optionalKey(
    Schema.String.annotate({ description: 'Directory summary filename. Default "_SUMMARY.md".' }),
  ),
  fileSummarySuffix: Schema.optionalKey(
    Schema.String.annotate({ description: 'Suffix for file summaries. Default ".summary.md".' }),
  ),
}).annotate({ description: 'Configurable filenames for the summary system.', identifier: 'CairnNamingConfig' })

const LocaleSchema = Schema.Literals(['en', 'fr']).annotate({
  description: 'Prose locale for generated guidance and report strings. Default "en".',
})

// "Make illegal states unrepresentable": thresholdLines is compared as `lineCount >
// thresholdLines` (core/DocSummaries.ts) — negative or fractional values are nonsensical,
// not just unusual, so they're rejected at the schema level instead of quietly
// misbehaving downstream.
const ThresholdLinesSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
  description: 'Line count above which a file needs a summary. Non-negative integer. Default 30.',
})

// "Parse, don't validate": raw JSON may write a bare string OR an array (ergonomics —
// one preset shouldn't force array syntax), but the *decoded* value is always an array.
// The union is collapsed once, here, instead of every consumer re-deriving
// `Array.isArray(x) ? x : [x]` for itself.
const ExtendsInputSchema = Schema.Union([Schema.String, Schema.Array(Schema.String)])
const ExtendsOutputSchema = Schema.Array(Schema.String)
const ExtendsSchema = ExtendsInputSchema.pipe(
  Schema.decodeTo(ExtendsOutputSchema, {
    decode: SchemaGetter.transform((value) => (Array.isArray(value) ? value : [value])),
    encode: SchemaGetter.passthroughSupertype(),
  }),
).annotate({
  description:
    'One or more config files (paths, relative to this file) to inherit from. Local fields win over inherited ones.',
})

/** The shape of a `.cairnrc.json` / `package.json#cairn` file, and of every `extends`
 * target: every field optional, `checks`/`naming` deep-mergeable, unknown keys rejected.
 * `$schema` is accepted-but-inert: it's the JSON Schema meta-property IDEs read for
 * autocomplete (see scripts/generate-schema.ts) — not a cairn setting. */
export const CairnConfigSchema = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({ description: 'JSON Schema URL for editor autocomplete/validation. Ignored by cairn.' }),
  ),
  checks: Schema.optionalKey(ChecksInputSchema),
  extends: Schema.optionalKey(ExtendsSchema),
  ignore: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: 'Globs to exclude from scanning. Default ["**/node_modules/**"].',
    }),
  ),
  locale: Schema.optionalKey(LocaleSchema),
  naming: Schema.optionalKey(NamingInputSchema),
  onlyGitTracked: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'Restrict the scanned file universe to files `git ls-files` reports as tracked/staged (issue #48) — so a local run sees the same files a fresh CI checkout would, ignoring untracked scratch docs and links to them. Default false (unchanged, glob-only behavior).',
    }),
  ),
  refs: Schema.optionalKey(RefsInputSchema),
  refsStampCommand: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Command agents should run to re-stamp reference hashes after `--refs` reports drift. Default ' +
        '"npx cairn check --refs --stamp". Deliberately separate from `stampCommand`: that field stamps ' +
        "SUMMARY freshness (commonly scoped `--summaries-only`, as this repo's own config does) and does " +
        'not stamp `--refs` sidecars at all — reusing it for the refs hint would suggest a command that ' +
        "silently doesn't do what it claims.",
    }),
  ),
  requireDirSummaries: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'Require a directory summary in every in-scope directory. Default true.',
    }),
  ),
  roots: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'Documentation roots to scan (globs allowed). Default ["docs"]. A pattern with no ".." segment ' +
        'anywhere and no absolute path must resolve inside the project directory — it fails loudly if ' +
        'the resolved directory turns out to be a symlink pointing outside it. Use a ".." segment or an ' +
        'absolute path to intentionally point a root outside the project (e.g. a monorepo sibling).',
    }),
  ),
  stampCommand: Schema.optionalKey(
    Schema.String.annotate({ description: 'Command agents should run to stamp hashes after editing docs.' }),
  ),
  thresholdLines: Schema.optionalKey(ThresholdLinesSchema),
}).annotate({
  description: 'Configuration for the cairn CLI (.cairnrc.json, .cairnrc, or the "cairn" key of package.json).',
  identifier: 'CairnConfig',
  title: 'cairn configuration',
})

/** One decoded, still-partial config layer (a single file, before `extends` is folded in). */
export type CairnConfigInput = Schema.Schema.Type<typeof CairnConfigSchema>

/** How a rule is satisfied. See `CoverageRequirementInputSchema`'s own comment
 * for why this is a discriminated union (room for future variants) rather
 * than an implicit, hardcoded fact of `checkCoverage`'s logic. */
export interface CoverageRequirement {
  readonly by: 'link'
}

/** A rule's `to` side: a declared kind id (a doc-kind target),
 * `{ external: 'path' }` — the rule is satisfied by a link resolving to a
 * real file on disk, not to a scanned/kind-classified doc — or
 * `{ external: 'url', pattern }` — satisfied by a link whose raw href
 * contains `pattern` (plain substring match). See
 * `CoverageTargetInputSchema`'s own comment for why this is a discriminated
 * union rather than a bare string. */
export type CoverageTarget =
  string | { readonly external: 'path' } | { readonly external: 'url'; readonly pattern: string }

/** True when `target` is a declared kind id, not `{ external: 'path' }` —
 * the ONE discriminant every `CoverageTarget` consumer needs, centralized
 * here (adversarial review, issue #28's PR) after it turned up hand-
 * re-derived as a bare `typeof target === 'string'` at 6 call sites across
 * `Config.ts`/`Coverage.ts`/`CheckCoverage.ts`. A future second `external`
 * variant (this file's own `CoverageTarget` comment already anticipates
 * one) needs this ONE function updated, not six independent re-derivations
 * found and fixed by hand. */
export const isKindTarget = (target: CoverageTarget): target is string => typeof target === 'string'

/** True when `target` is `{ external: 'url', pattern }`, not a kind id or
 * `{ external: 'path' }` — the second `external` discriminant `isKindTarget`'s
 * own comment anticipated, centralized the same way for the same reason: a
 * future third `external` variant needs this ONE function (and
 * `isKindTarget`) updated, not every call site re-deriving `.external`
 * itself. */
export const isUrlTarget = (target: CoverageTarget): target is { readonly external: 'url'; readonly pattern: string } =>
  !isKindTarget(target) && target.external === 'url'

/** The explicit, named spelling of a bare-array `to` — see
 * `AnyTargetInputSchema`'s own comment for why both spellings are kept. */
export interface CoverageTargetAny {
  readonly any: readonly CoverageTarget[]
}

/** General N-of-M cardinality — see `AtLeastTargetInputSchema`'s own comment
 * for the gap this closes and why "all of these" has no separate variant. */
export interface CoverageTargetAtLeast {
  readonly atLeast: {
    readonly n: number
    readonly of: readonly CoverageTarget[]
  }
}

/** Every shape `CoverageRule.to` can take: a single target (satisfied by any
 * one matching link); an array, or the equivalent `{ any: [...] }` (either
 * spelling satisfied by a link matching ANY ONE of them — alternation/OR);
 * or `{ atLeast: { n, of } }` (satisfied when at least `n` of `of`'s targets
 * EACH have their own satisfying link — general N-of-M). See
 * `CoverageTargetOrAlternativesInputSchema` (../Config.ts) for the schema
 * this type mirrors. */
export type CoverageToSpec = CoverageTarget | readonly CoverageTarget[] | CoverageTargetAny | CoverageTargetAtLeast

/** A trusted type predicate (not just `Array.isArray` inline) — TS doesn't
 * reliably narrow a `T | readonly T[]` union back down to the bare `T` in
 * the `false` branch of an inline `Array.isArray(...)` check (confirmed:
 * `../program/structure/CheckCoverage.ts`'s report formatter hit exactly
 * this), so both `targetsOf` below and every OTHER consumer that needs to
 * branch on "array of alternatives or a single target" go through this one
 * named, exported predicate instead of repeating an inline `Array.isArray`
 * that silently fails to narrow. */
export const isTargetArray = (to: CoverageToSpec): to is readonly CoverageTarget[] => Array.isArray(to)

/** True when `to` is the explicit `{ any: [...] }` spelling (not the bare
 * array, not `{ atLeast: ... }`, not a single target) — centralized the same
 * way `isKindTarget`/`isUrlTarget` are, for the same reason: every consumer
 * branching on `to`'s shape goes through one named predicate, not a
 * re-derived `'any' in to` inline check. */
export const isAnyTarget = (to: CoverageToSpec): to is CoverageTargetAny =>
  !isTargetArray(to) && typeof to === 'object' && to !== null && 'any' in to

/** True when `to` is `{ atLeast: { n, of } }` — see `isAnyTarget`'s own
 * comment for why this is a centralized predicate rather than an inline
 * `'atLeast' in to` re-derived at each call site. */
export const isAtLeastTarget = (to: CoverageToSpec): to is CoverageTargetAtLeast =>
  !isTargetArray(to) && typeof to === 'object' && to !== null && 'atLeast' in to

/** Normalises `CoverageRule.to` (any of its four shapes — see
 * `CoverageToSpec`) into a uniform, non-empty list of individual targets —
 * the ONE place every consumer that just needs "every target this rule
 * could possibly match" (`../../program/structure/CheckCoverage.ts`'s
 * dedup key and orphan-candidate/external-candidate collection) turns "one
 * target or many, however grouped" into "a flat list to try," matching
 * `isKindTarget`/`isUrlTarget`'s own centralization precedent above. Does
 * NOT carry `atLeast`'s cardinality (`n`) — a consumer that needs to know
 * HOW MANY of these must be satisfied, not just which targets are possible,
 * needs `quantifierOf` instead. */
export const targetsOf = (to: CoverageToSpec): readonly CoverageTarget[] =>
  isTargetArray(to) ? to : isAnyTarget(to) ? to.any : isAtLeastTarget(to) ? to.atLeast.of : [to]

/** The general shape every `to` variant reduces to: "at least `n` of
 * `targets` must each have their own satisfying link." A single target and
 * the OR-shaped variants (array / `{ any }`) are `n: 1` over their own
 * target list — the same "at least one" semantics they always had, just
 * expressed through the same lens `{ atLeast }` introduces, rather than as a
 * separate special case. This is the ONE place `../structure/Coverage.ts`'s
 * `resolveRuleEdges` reads a rule's cardinality from — a future quantifier
 * shape needs this function (and this function alone) updated to be
 * resolved correctly. */
export const quantifierOf = (
  to: CoverageToSpec,
): { readonly n: number; readonly targets: readonly CoverageTarget[] } =>
  isAtLeastTarget(to) ? { n: to.atLeast.n, targets: to.atLeast.of } : { n: 1, targets: targetsOf(to) }

export interface CoverageRule {
  /** Real, in-context guidance shown in the report when unmet — see
   * `CoverageRuleInputSchema`'s own comment for why this exists alongside
   * `name`. */
  readonly description?: string
  readonly from: string
  /** Distinguishes this rule from another sharing the same `from`/`to` pair
   * but a different meaning — see `CoverageRuleInputSchema`'s own comment. */
  readonly name?: string
  /** `'sibling'` restricts satisfaction to a same-parent-directory `to`-kind
   * doc; `{ under: 'some/dir' }` restricts it to a `to`-kind doc nested
   * anywhere below that project-relative directory — see
   * `CoverageRuleInputSchema`'s own comment for why. Absent means today's
   * default: satisfied by a `to`-kind doc anywhere in the corpus. */
  readonly scope?: 'sibling' | { readonly under: string }
  /** A single target (satisfied by any one matching link); an array, or the
   * equivalent `{ any: [...] }`, satisfied by a link matching ANY ONE of
   * them (alternation/OR, e.g. requiring a link to EITHER a `spikes`-kind
   * doc OR an `external-evidence`-kind doc); or `{ atLeast: { n, of } }`,
   * satisfied when at least `n` of `of`'s targets EACH have a satisfying
   * link (general N-of-M). See `targetsOf`/`quantifierOf` for how every
   * consumer normalises this. */
  readonly to: CoverageToSpec
  /** Defaults to `{ by: 'link' }` when absent — every rule written before
   * this field existed already meant that. */
  readonly via?: CoverageRequirement
}

export interface CoverageConfig {
  readonly exempt: readonly string[]
  readonly kinds: readonly KindDef[]
  readonly rules: readonly CoverageRule[]
}

/** One named group of docs whose outbound links count as covering a source
 * file — see `DocCoverageGroupInputSchema`'s own comment for why `kind`
 * exists (report clarity, not per-kind separate obligations). */
export interface DocCoverageGroup {
  readonly glob: string
  readonly kind: string
}

export interface DocCoverageConfig {
  readonly coveredBy: readonly DocCoverageGroup[]
  readonly exempt: readonly string[]
  readonly sources: readonly string[]
}

/** One glob and its own staleness threshold — see `FreshnessRuleInputSchema`'s
 * own comment for why this is a separate check rather than a `CoverageRule`
 * field. */
export interface FreshnessRule {
  readonly glob: string
  readonly maxAgeDays: number
}

export interface FreshnessConfig {
  readonly rules: readonly FreshnessRule[]
}

/** See `StoryMapTiersInputSchema`'s own comment for why `globs` is the only field. */
export interface StoryMapTiersConfig {
  readonly globs: readonly string[]
}

export interface ProseRefsConfig {
  readonly ignore: readonly string[]
}

/** One glob and the granularity `--refs` uses for a target matching it — see
 * `RefsScopeGroupInputSchema`'s own comment for the first-match-wins
 * semantics. */
export interface RefsScopeGroup {
  readonly glob: string
  readonly unit: 'whole-file' | 'ignore'
}

export interface RefsConfig {
  readonly scope: readonly RefsScopeGroup[]
}

export interface ChecksConfig {
  /** `null` = disabled (the default) — presence of `checks.coverage` in a
   * config file is itself the opt-in, not a separate boolean flag. */
  readonly coverage: CoverageConfig | null
  /** cairn#187 item 2: `coverage` above collapses BOTH "never configured"
   * and "explicitly `checks.coverage: false`" down to the same `null` — by
   * design, so every consumer of `coverage` keeps a simple two-state check.
   * But `--refs`' own kind-guidance discoverability tip (`CheckRefs.ts`'s
   * `formatRefsReport`) needs the THIRD state a plain `null` can't carry: a
   * repo that considered `checks.coverage.kinds` and declined has no way to
   * silence a tip that otherwise fires forever, on every stale-refs report.
   * `false` here means "the resolved `checks.coverage: false` was the
   * winning layer" — computed alongside `coverage` in `layerConfig`, not
   * derived from it, since `coverage` itself no longer carries the
   * distinction by the time it's resolved. */
  readonly coverageExplicitlyDisabled: boolean
  /** `null` = disabled (the default), same convention as `coverage` above. */
  readonly docCoverage: DocCoverageConfig | null
  /** `null` = disabled (the default), same convention as `coverage`/
   * `docCoverage` above. */
  readonly freshness: FreshnessConfig | null
  readonly links: boolean
  /** Never `null` — unlike `coverage`/`docCoverage`/`freshness`, this doesn't
   * gate whether `--prose-refs` runs (the CLI flag alone does that); it only
   * tunes its ignore list, so an empty list is the only "off" state. */
  readonly proseRefs: ProseRefsConfig
  /** `null` = disabled (the default), same convention as `coverage`/
   * `docCoverage`/`freshness` above. */
  readonly storyMapTiers: StoryMapTiersConfig | null
  readonly summaries: boolean
}

// Re-exported so a consumer that only imports from `Config.ts` (the usual
// entry point for config-shaped types) doesn't also need to know
// `KindSelector` lives in `./structure/DocMetadata.ts`.
export type { KindDef, KindSelector } from './structure/DocMetadata.ts'

/** Report language. English is the default for broad reuse; French mirrors the tool's
 * origin. Defined here (not in `program/locale.ts`, which re-exports it) because it's a
 * config field type, and `core/` cannot depend on `program/` (the dependency points the
 * other way: `program/` orchestrates IO around `core/`, never the reverse).
 * Derived from `LocaleSchema.literals` so the type and the runtime list of valid values
 * (e.g. the CLI's `--locale` choice list) can never drift apart. */
export const LOCALES = LocaleSchema.literals
export type Locale = (typeof LOCALES)[number]

/** Same reasoning as `Locale` above: `program/CheckSummaries.ts` needs this constant
 * too, and it can't be defined there, since `core/` can't depend on `program/`. */
export const DEFAULT_STAMP_COMMAND = 'npx cairn check --summaries-only --stamp'

/** Issue #162 item 1: the `--refs` stale-report's own fix hint used to be
 * hardcoded (guessing a `pnpm run stamp:refs` script that may not exist, and
 * omitting any formatter step a repo's real ref-stamping command needs) —
 * see `program/links/CheckRefs.ts`'s `formatRefsReport`. Deliberately NOT
 * `DEFAULT_STAMP_COMMAND` reused as-is: that command is conventionally
 * scoped to `--summaries-only` (this repo's own `.cairnrc.json` included) and
 * does not stamp `--refs` sidecars — see `refsStampCommand`'s own schema
 * description above. */
export const DEFAULT_REFS_STAMP_COMMAND = 'npx cairn check --refs --stamp'

export interface ResolvedConfig {
  readonly checks: ChecksConfig
  readonly ignore: readonly string[]
  readonly locale: Locale
  readonly naming: Naming
  readonly onlyGitTracked: boolean
  readonly refs: RefsConfig
  readonly refsStampCommand: string
  readonly requireDirSummaries: boolean
  readonly roots: readonly string[]
  readonly stampCommand: string
  readonly thresholdLines: number
}

export interface Overrides {
  readonly locale?: Locale
  readonly roots?: readonly string[]
  readonly thresholdLines?: number
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  checks: {
    coverage: null,
    coverageExplicitlyDisabled: false,
    docCoverage: null,
    freshness: null,
    links: true,
    proseRefs: { ignore: [] },
    storyMapTiers: null,
    summaries: true,
  },
  ignore: ['**/node_modules/**'],
  locale: 'en',
  naming: DEFAULT_NAMING,
  onlyGitTracked: false,
  refs: { scope: [] },
  refsStampCommand: DEFAULT_REFS_STAMP_COMMAND,
  requireDirSummaries: true,
  roots: ['docs'],
  stampCommand: DEFAULT_STAMP_COMMAND,
  thresholdLines: DEFAULT_THRESHOLD_LINES,
}

/** Strictly decode one raw (untrusted) config layer: unknown keys and wrong-typed values
 * are rejected via a `Failure` — never silently ignored or defaulted. Total and pure over
 * its actual domain, any value `JSON.parse` can produce (the only inputs this module's
 * callers ever pass, including circular-reference-free by construction): `effect/Schema`
 * already hands back a `Result`, so collapsing it into a thrown exception here (as an
 * earlier version of this function did) would be a purity leak inside a module
 * documented as "no IO" — the throw/catch decision belongs to whichever caller is
 * equipped to make it (the edge, in `../config.ts`), not to the decoder. (Not total over
 * *every* JS value of type `unknown`: an object with a throwing property getter would
 * still propagate that throw — out of scope for a config decoder, not worth the
 * complexity of catching arbitrary property-access exceptions from a value no real
 * caller constructs.) Formatting a `Failure` for a human is a separate, equally pure
 * concern (`formatConfigError`, below): decoding has no business knowing which file it
 * came from — that's the caller's context, not the decoder's. */
export const decodeConfig = (raw: unknown): Result.Result<CairnConfigInput, Schema.SchemaError> =>
  Schema.decodeUnknownResult(CairnConfigSchema, { errors: 'all', onExcessProperty: 'error' })(raw)

/** Render a decode failure into a clear, actionable, file-scoped message. */
export const formatConfigError = (error: Schema.SchemaError, file: string): string =>
  `cairn: invalid config in ${file}:\n${error.message}`

/** Layer a decoded config over a resolved base: `checks`/`naming` deep-merge field by
 * field, everything else replaces when present. Used for `extends` presets, the local
 * file, and CLI overrides — always in "later wins" precedence order. */
export const layerConfig = (base: ResolvedConfig, layer: CairnConfigInput): ResolvedConfig => ({
  ...base,
  ...(layer.ignore === undefined ? {} : { ignore: layer.ignore }),
  ...(layer.locale === undefined ? {} : { locale: layer.locale }),
  ...(layer.onlyGitTracked === undefined ? {} : { onlyGitTracked: layer.onlyGitTracked }),
  ...(layer.requireDirSummaries === undefined ? {} : { requireDirSummaries: layer.requireDirSummaries }),
  ...(layer.refsStampCommand === undefined ? {} : { refsStampCommand: layer.refsStampCommand }),
  ...(layer.roots === undefined ? {} : { roots: layer.roots }),
  ...(layer.stampCommand === undefined ? {} : { stampCommand: layer.stampCommand }),
  ...(layer.thresholdLines === undefined ? {} : { thresholdLines: layer.thresholdLines }),
  checks: {
    // A whole config object, not a scalar — a layer that specifies
    // `checks.coverage` at all REPLACES the base's coverage config entirely
    // (kinds/rules aren't merged field-by-field), matching how `roots`/
    // `ignore` already replace rather than merge above; only its `links`/
    // `summaries` sibling booleans use `??` precedence. Three-way, not a
    // truthy check: `undefined` (key absent) inherits `base`; `false`
    // (explicit re-disable) resolves to `null`; anything else REPLACES
    // wholesale. A plain `layer.checks?.coverage ? ... : base.checks.coverage`
    // would silently treat `false` as "absent" (both falsy) and inherit the
    // base's coverage instead of disabling it — the exact bug this field
    // exists to fix.
    coverage:
      layer.checks?.coverage === undefined
        ? base.checks.coverage
        : layer.checks.coverage === false
          ? null
          : {
              exempt: layer.checks.coverage.exempt ?? [],
              kinds: layer.checks.coverage.kinds,
              rules: layer.checks.coverage.rules,
            },
    // Same three-way shape as `coverage` above, but tracking the ONE bit
    // `coverage`'s own `null` collapse deliberately throws away: `undefined`
    // inherits `base` (an ancestor layer's explicit decline, or the
    // never-configured default, carries forward unchanged); `false` sets
    // `true` (THIS layer is the one declining it); anything else — a real
    // coverage config object — clears it back to `false` (configuring
    // coverage is not declining it, even if an ancestor layer had).
    coverageExplicitlyDisabled:
      layer.checks?.coverage === undefined ? base.checks.coverageExplicitlyDisabled : layer.checks.coverage === false,
    // Same three-way (undefined inherits / false disables / anything else
    // replaces wholesale) reasoning as `coverage` above.
    docCoverage:
      layer.checks?.docCoverage === undefined
        ? base.checks.docCoverage
        : layer.checks.docCoverage === false
          ? null
          : {
              coveredBy: layer.checks.docCoverage.coveredBy,
              exempt: layer.checks.docCoverage.exempt ?? [],
              sources: layer.checks.docCoverage.sources,
            },
    // Same three-way (undefined inherits / false disables / anything else
    // replaces wholesale) reasoning as `coverage`/`docCoverage` above.
    freshness:
      layer.checks?.freshness === undefined
        ? base.checks.freshness
        : layer.checks.freshness === false
          ? null
          : { rules: layer.checks.freshness.rules },
    links: layer.checks?.links ?? base.checks.links,
    // Not the three-way undefined/false/replace pattern above — `proseRefs`
    // has no disabled state (see `ChecksConfig.proseRefs`'s own comment), so
    // an absent `checks.proseRefs` in this layer simply inherits `base`, and
    // a present one replaces `ignore` wholesale (same as `roots`/top-level
    // `ignore` do), never merges array-by-array with the base's list.
    proseRefs:
      layer.checks?.proseRefs === undefined ? base.checks.proseRefs : { ignore: layer.checks.proseRefs.ignore ?? [] },
    // Same three-way (undefined inherits / false disables / anything else
    // replaces wholesale) reasoning as `coverage`/`docCoverage`/`freshness` above.
    storyMapTiers:
      layer.checks?.storyMapTiers === undefined
        ? base.checks.storyMapTiers
        : layer.checks.storyMapTiers === false
          ? null
          : { globs: layer.checks.storyMapTiers.globs },
    summaries: layer.checks?.summaries ?? base.checks.summaries,
  },
  naming: {
    dirSummary: layer.naming?.dirSummary ?? base.naming.dirSummary,
    fileSummarySuffix: layer.naming?.fileSummarySuffix ?? base.naming.fileSummarySuffix,
  },
  // Wholesale replace when present, same as `roots`/top-level `ignore` above
  // (and `proseRefs.ignore`) — not merged group-by-group with the base's
  // list; absent inherits `base` unchanged.
  refs: { scope: layer.refs?.scope ?? base.refs.scope },
})
