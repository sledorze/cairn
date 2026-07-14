// The config domain: shape, defaults, strict decode, and layering — pure decision
// logic, no IO. The impure edge (`../config.ts`) reads `.cairnrc(.json)` /
// `package.json`'s `cairn` key from disk and hands the raw JSON here.
//
// `CairnConfigSchema` is the single source of truth for: (1) the strict per-layer
// decode below, and (2) the JSON Schema shipped for editor autocomplete
// (`scripts/generate-schema.ts` -> `schema/cairn.schema.json`, via `JSONSchema.make`).
// Every field is optional (a config file only specifies what it overrides), but
// unknown keys and wrong-typed values are rejected with a clear, actionable error —
// never silently ignored. A config system that quietly falls back to defaults on a
// typo would undermine cairn's own thesis: it's a CI *guarantee*, and a guarantee
// that silently checks the wrong thing isn't one.
//
// This module uses `effect`'s `Schema`/`Either`/`ParseResult` — pure, synchronous,
// side-effect-free combinators (unlike `Effect`/`Layer`/`Runtime`, which represent
// the effectful, scheduled part of the library) — so it stays within `core/`'s "no
// IO" contract despite depending on `effect`.

import type { Either } from 'effect'
import { ParseResult, Schema } from 'effect'

import type { Naming } from './DocSummaries.ts'
import { DEFAULT_NAMING, DEFAULT_THRESHOLD_LINES } from './DocSummaries.ts'

const ChecksInputSchema = Schema.Struct({
  links: Schema.optional(
    Schema.Boolean.annotations({ description: 'Enable Markdown dead-link checking. Default true.' }),
  ),
  summaries: Schema.optional(
    Schema.Boolean.annotations({
      description: 'Enable summary freshness checking (content-hash based). Default true.',
    }),
  ),
}).annotations({ description: 'Which checks `cairn check` runs.', identifier: 'CairnChecksConfig' })

const NamingInputSchema = Schema.Struct({
  dirSummary: Schema.optional(
    Schema.String.annotations({ description: 'Directory summary filename. Default "_SUMMARY.md".' }),
  ),
  fileSummarySuffix: Schema.optional(
    Schema.String.annotations({ description: 'Suffix for file summaries. Default ".summary.md".' }),
  ),
}).annotations({ description: 'Configurable filenames for the summary system.', identifier: 'CairnNamingConfig' })

const LocaleSchema = Schema.Literal('en', 'fr').annotations({
  description: 'Prose locale for generated guidance and report strings. Default "en".',
})

// "Make illegal states unrepresentable": thresholdLines is compared as `lineCount >
// thresholdLines` (core/DocSummaries.ts) — negative or fractional values are nonsensical,
// not just unusual, so they're rejected at the schema level instead of quietly
// misbehaving downstream.
const ThresholdLinesSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative()).annotations({
  description: 'Line count above which a file needs a summary. Non-negative integer. Default 30.',
})

// "Parse, don't validate": raw JSON may write a bare string OR an array (ergonomics —
// one preset shouldn't force array syntax), but the *decoded* value is always an array.
// The union is collapsed once, here, instead of every consumer re-deriving
// `Array.isArray(x) ? x : [x]` for itself.
const ExtendsInputSchema = Schema.Union(Schema.String, Schema.Array(Schema.String))
const ExtendsOutputSchema = Schema.Array(Schema.String)
const ExtendsSchema = Schema.transform(ExtendsInputSchema, ExtendsOutputSchema, {
  decode: (value) => (Array.isArray(value) ? value : [value]),
  encode: (value) => value,
}).annotations({
  description:
    'One or more config files (paths, relative to this file) to inherit from. Local fields win over inherited ones.',
})

/** The shape of a `.cairnrc.json` / `package.json#cairn` file, and of every `extends`
 * target: every field optional, `checks`/`naming` deep-mergeable, unknown keys rejected.
 * `$schema` is accepted-but-inert: it's the JSON Schema meta-property IDEs read for
 * autocomplete (see scripts/generate-schema.ts) — not a cairn setting. */
export const CairnConfigSchema = Schema.Struct({
  $schema: Schema.optional(
    Schema.String.annotations({ description: 'JSON Schema URL for editor autocomplete/validation. Ignored by cairn.' }),
  ),
  checks: Schema.optional(ChecksInputSchema),
  extends: Schema.optional(ExtendsSchema),
  ignore: Schema.optional(
    Schema.Array(Schema.String).annotations({
      description: 'Globs to exclude from scanning. Default ["**/node_modules/**"].',
    }),
  ),
  locale: Schema.optional(LocaleSchema),
  naming: Schema.optional(NamingInputSchema),
  requireDirSummaries: Schema.optional(
    Schema.Boolean.annotations({
      description: 'Require a directory summary in every in-scope directory. Default true.',
    }),
  ),
  roots: Schema.optional(
    Schema.Array(Schema.String).annotations({
      description: 'Documentation roots to scan (globs allowed). Default ["docs"].',
    }),
  ),
  stampCommand: Schema.optional(
    Schema.String.annotations({ description: 'Command agents should run to stamp hashes after editing docs.' }),
  ),
  thresholdLines: Schema.optional(ThresholdLinesSchema),
}).annotations({
  description: 'Configuration for the cairn CLI (.cairnrc.json, .cairnrc, or the "cairn" key of package.json).',
  identifier: 'CairnConfig',
  title: 'cairn configuration',
})

/** One decoded, still-partial config layer (a single file, before `extends` is folded in). */
export type CairnConfigInput = Schema.Schema.Type<typeof CairnConfigSchema>

export interface ChecksConfig {
  readonly links: boolean
  readonly summaries: boolean
}

/** Report language. English is the default for broad reuse; French mirrors the tool's
 * origin. Defined here (not in `program/locale.ts`, which re-exports it) because it's a
 * config field type, and `core/` cannot depend on `program/` (the dependency points the
 * other way: `program/` orchestrates IO around `core/`, never the reverse). */
export type Locale = 'en' | 'fr'

/** Same reasoning as `Locale` above: `program/CheckSummaries.ts` needs this constant
 * too, and it can't be defined there, since `core/` can't depend on `program/`. */
export const DEFAULT_STAMP_COMMAND = 'npx cairn check --summaries-only --stamp'

export interface ResolvedConfig {
  readonly checks: ChecksConfig
  readonly ignore: readonly string[]
  readonly locale: Locale
  readonly naming: Naming
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
  checks: { links: true, summaries: true },
  ignore: ['**/node_modules/**'],
  locale: 'en',
  naming: DEFAULT_NAMING,
  requireDirSummaries: true,
  roots: ['docs'],
  stampCommand: DEFAULT_STAMP_COMMAND,
  thresholdLines: DEFAULT_THRESHOLD_LINES,
}

/** Strictly decode one raw (untrusted) config layer: unknown keys and wrong-typed values
 * are rejected via a `Left` — never silently ignored or defaulted. Total and pure over
 * its actual domain, any value `JSON.parse` can produce (the only inputs this module's
 * callers ever pass, including circular-reference-free by construction): `effect/Schema`
 * already hands back an `Either`, so collapsing it into a thrown exception here (as an
 * earlier version of this function did) would be a purity leak inside a module
 * documented as "no IO" — the throw/catch decision belongs to whichever caller is
 * equipped to make it (the edge, in `../config.ts`), not to the decoder. (Not total over
 * *every* JS value of type `unknown`: an object with a throwing property getter would
 * still propagate that throw — out of scope for a config decoder, not worth the
 * complexity of catching arbitrary property-access exceptions from a value no real
 * caller constructs.) Formatting a `Left` for a human is a separate, equally pure
 * concern (`formatConfigError`, below): decoding has no business knowing which file it
 * came from — that's the caller's context, not the decoder's. */
export const decodeConfig = (raw: unknown): Either.Either<CairnConfigInput, ParseResult.ParseError> =>
  Schema.decodeUnknownEither(CairnConfigSchema, { errors: 'all', onExcessProperty: 'error' })(raw)

/** Render a decode failure into a clear, actionable, file-scoped message. */
export const formatConfigError = (error: ParseResult.ParseError, file: string): string =>
  `cairn: invalid config in ${file}:\n${ParseResult.TreeFormatter.formatErrorSync(error)}`

/** Layer a decoded config over a resolved base: `checks`/`naming` deep-merge field by
 * field, everything else replaces when present. Used for `extends` presets, the local
 * file, and CLI overrides — always in "later wins" precedence order. */
export const layerConfig = (base: ResolvedConfig, layer: CairnConfigInput): ResolvedConfig => ({
  ...base,
  ...(layer.ignore === undefined ? {} : { ignore: layer.ignore }),
  ...(layer.locale === undefined ? {} : { locale: layer.locale }),
  ...(layer.requireDirSummaries === undefined ? {} : { requireDirSummaries: layer.requireDirSummaries }),
  ...(layer.roots === undefined ? {} : { roots: layer.roots }),
  ...(layer.stampCommand === undefined ? {} : { stampCommand: layer.stampCommand }),
  ...(layer.thresholdLines === undefined ? {} : { thresholdLines: layer.thresholdLines }),
  checks: {
    links: layer.checks?.links ?? base.checks.links,
    summaries: layer.checks?.summaries ?? base.checks.summaries,
  },
  naming: {
    dirSummary: layer.naming?.dirSummary ?? base.naming.dirSummary,
    fileSummarySuffix: layer.naming?.fileSummarySuffix ?? base.naming.fileSummarySuffix,
  },
})
