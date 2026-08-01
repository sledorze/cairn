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
// This module uses `effect`'s `Schema`/`Result`/`SchemaError` — pure, synchronous,
// side-effect-free combinators (unlike `Effect`/`Layer`/`Runtime`, which represent
// the effectful, scheduled part of the library) — so it stays within `core/`'s "no
// IO" contract despite depending on `effect`.

import type { Result, SchemaError } from 'effect'
import { Schema, SchemaGetter } from 'effect'

import type { KindDef } from './structure/DocMetadata.ts'
import type { Naming } from './summaries/DocSummaries.ts'
import { DEFAULT_NAMING, DEFAULT_THRESHOLD_LINES } from './summaries/DocSummaries.ts'

// `by: Schema.Literal('path')` — a single-variant discriminated union today,
// deliberately: `KindSelector` (../structure/DocMetadata.ts) already has room
// for `by: 'frontmatter'`/`by: 'any'` variants, but this schema only VALIDATES
// the one this increment implements. Adding a variant later is a new
// `Schema.Literal` branch, not a breaking change to configs already written
// with `by: 'path'`.
const KindSelectorInputSchema = Schema.Struct({
  by: Schema.Literal('path'),
  glob: Schema.String,
}).annotate({
  description: 'How a doc is classified into a kind. Only `by: "path"` today.',
  identifier: 'CairnKindSelector',
})

const KindDefInputSchema = Schema.Struct({
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

// `to` is either a declared kind id (a doc-kind target, the original shape)
// OR `{ external: 'path' }` — issue #28's third v1 check, doc→code
// reference resolution: the rule is satisfied by a link that resolves to a
// REAL FILE on disk, not to another scanned/kind-classified doc. A single-
// variant object today (matching `KindSelector`/`CoverageRequirement`'s own
// `by`-discriminant reasoning), so a later external kind (a URL, an env var)
// is a new `external` value, not a breaking change to `CoverageRule`'s shape.
const CoverageTargetInputSchema = Schema.Union([
  Schema.String,
  Schema.Struct({ external: Schema.Literal('path') }),
]).annotate({
  description:
    'A declared kind id (a doc-kind target), or `{ external: "path" }` — a link must resolve to a real file on disk, not to a scanned doc.',
  identifier: 'CairnCoverageTarget',
})

const CoverageRuleInputSchema = Schema.Struct({
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
  to: CoverageTargetInputSchema,
  via: Schema.optionalKey(CoverageRequirementInputSchema),
}).annotate({
  description:
    'Every doc of kind `from` must link somewhere to a doc of kind `to` — or, when `to` is `{ external: "path" }`, to a real file on disk.',
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
  .pipe(
    Schema.check(
      Schema.makeFilter((coverage) => {
        const declaredIds = new Set(coverage.kinds.map((k) => k.id))
        const issues: Schema.FilterIssue[] = []
        coverage.rules.forEach((rule, i) => {
          if (!declaredIds.has(rule.from)) {
            issues.push({ issue: `references undeclared kind "${rule.from}"`, path: ['rules', i, 'from'] })
          }
          // `to` names no kind at all when it's `{ external: 'path' }` — the
          // undeclared-kind check only applies to the plain kind-id string shape.
          if (typeof rule.to === 'string' && !declaredIds.has(rule.to)) {
            issues.push({ issue: `references undeclared kind "${rule.to}"`, path: ['rules', i, 'to'] })
          }
        })
        return issues
      }),
    ),
  )

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

const ChecksInputSchema = Schema.Struct({
  coverage: Schema.optionalKey(CoverageOrDisabledSchema),
  links: Schema.optionalKey(
    Schema.Boolean.annotate({ description: 'Enable Markdown dead-link checking. Default true.' }),
  ),
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
  requireDirSummaries: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'Require a directory summary in every in-scope directory. Default true.',
    }),
  ),
  roots: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: 'Documentation roots to scan (globs allowed). Default ["docs"].',
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

/** A rule's `to` side: a declared kind id (a doc-kind target), or
 * `{ external: 'path' }` — the rule is satisfied by a link resolving to a
 * real file on disk, not to a scanned/kind-classified doc. See
 * `CoverageTargetInputSchema`'s own comment for why this is a discriminated
 * union rather than a bare string. */
export type CoverageTarget = string | { readonly external: 'path' }

export interface CoverageRule {
  readonly from: string
  /** Distinguishes this rule from another sharing the same `from`/`to` pair
   * but a different meaning — see `CoverageRuleInputSchema`'s own comment. */
  readonly name?: string
  readonly to: CoverageTarget
  /** Defaults to `{ by: 'link' }` when absent — every rule written before
   * this field existed already meant that. */
  readonly via?: CoverageRequirement
}

export interface CoverageConfig {
  readonly exempt: readonly string[]
  readonly kinds: readonly KindDef[]
  readonly rules: readonly CoverageRule[]
}

export interface ChecksConfig {
  /** `null` = disabled (the default) — presence of `checks.coverage` in a
   * config file is itself the opt-in, not a separate boolean flag. */
  readonly coverage: CoverageConfig | null
  readonly links: boolean
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

export interface ResolvedConfig {
  readonly checks: ChecksConfig
  readonly ignore: readonly string[]
  readonly locale: Locale
  readonly naming: Naming
  readonly onlyGitTracked: boolean
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
  checks: { coverage: null, links: true, summaries: true },
  ignore: ['**/node_modules/**'],
  locale: 'en',
  naming: DEFAULT_NAMING,
  onlyGitTracked: false,
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
export const decodeConfig = (raw: unknown): Result.Result<CairnConfigInput, SchemaError.SchemaError> =>
  Schema.decodeUnknownResult(CairnConfigSchema, { errors: 'all', onExcessProperty: 'error' })(raw)

/** Render a decode failure into a clear, actionable, file-scoped message. */
export const formatConfigError = (error: SchemaError.SchemaError, file: string): string =>
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
    links: layer.checks?.links ?? base.checks.links,
    summaries: layer.checks?.summaries ?? base.checks.summaries,
  },
  naming: {
    dirSummary: layer.naming?.dirSummary ?? base.naming.dirSummary,
    fileSummarySuffix: layer.naming?.fileSummarySuffix ?? base.naming.fileSummarySuffix,
  },
})
