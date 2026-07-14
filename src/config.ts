// Configuration loading & root-glob expansion for the CLI. This is the Node
// (impure) edge of the tool: it reads `.cairnrc(.json)` or the
// `cairn` key of `package.json`, merges with defaults, and expands
// `roots` globs to concrete directories. The pure planners never see this — they
// receive already-resolved values.
//
// Validation is `effect/Schema`-driven — idiomatic to the rest of the stack, which
// already depends on `effect`. `CairnConfigSchema` is the single source of truth for:
// (1) the strict per-layer decode below, and (2) the JSON Schema shipped for editor
// autocomplete (`scripts/generate-schema.ts` -> `schema/cairn.schema.json`, via
// `JSONSchema.make`). Every field is optional (a config file only specifies what it
// overrides), but unknown keys and wrong-typed values are rejected with a clear,
// actionable, file-scoped error — never silently ignored. A config system that quietly
// falls back to defaults on a typo would undermine cairn's own thesis: it's a CI
// *guarantee*, and a guarantee that silently checks the wrong thing isn't one.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { Either, ParseResult, Schema } from 'effect'

import { DEFAULT_NAMING, DEFAULT_THRESHOLD_LINES } from './core/DocSummaries.ts'
import { globToRegExp } from './core/glob.ts'
import { toPosix } from './core/paths.ts'
import { DEFAULT_STAMP_COMMAND } from './program/CheckSummaries.ts'
import type { Locale } from './program/locale.ts'

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

const ExtendsSchema = Schema.Union(Schema.String, Schema.Array(Schema.String)).annotations({
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
  thresholdLines: Schema.optional(
    Schema.Number.annotations({ description: 'Line count above which a file needs a summary. Default 30.' }),
  ),
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

export interface ResolvedConfig {
  readonly checks: ChecksConfig
  readonly ignore: readonly string[]
  readonly locale: Locale
  readonly naming: { readonly dirSummary: string; readonly fileSummarySuffix: string }
  readonly requireDirSummaries: boolean
  readonly roots: readonly string[]
  readonly stampCommand: string
  readonly thresholdLines: number
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

export interface Overrides {
  readonly locale?: Locale
  readonly roots?: readonly string[]
  readonly thresholdLines?: number
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Strictly decode one raw (untrusted) config layer: unknown keys and wrong-typed values
 * are rejected with a clear, actionable message — never silently ignored or defaulted. */
export const decodeConfig = (raw: unknown, file: string): CairnConfigInput => {
  const result = Schema.decodeUnknownEither(CairnConfigSchema, { errors: 'all', onExcessProperty: 'error' })(raw)
  if (Either.isLeft(result)) {
    throw new Error(`cairn: invalid config in ${file}:\n${ParseResult.TreeFormatter.formatErrorSync(result.left)}`, {
      cause: result.left,
    })
  }
  return result.right
}

/** Layer a decoded config over a resolved base: `checks`/`naming` deep-merge field by
 * field, everything else replaces when present. Used for `extends` presets, the local
 * file, and (via `loadConfig`) CLI overrides — always in "later wins" precedence order. */
const layerConfig = (base: ResolvedConfig, layer: CairnConfigInput): ResolvedConfig => ({
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

const CONFIG_FILENAMES = ['.cairnrc.json', '.cairnrc']

/** Parse JSON, turning a syntax error into a clear, actionable message. */
export const parseRcJson = (text: string, file: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`cairn: invalid JSON in ${file}: ${(error as Error).message}`, { cause: error })
  }
}

/** Read the raw config plus the file it came from: an rc file, the package.json key, or null. */
const readRawConfig = (cwd: string, explicitPath?: string): { file: string; raw: unknown } | null => {
  const candidates = explicitPath ? [path.resolve(cwd, explicitPath)] : CONFIG_FILENAMES.map((f) => path.join(cwd, f))
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return { file, raw: parseRcJson(fs.readFileSync(file, 'utf8'), file) }
    }
  }
  const pkgPath = path.join(cwd, 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pkg = parseRcJson(fs.readFileSync(pkgPath, 'utf8'), pkgPath)
    if (isRecord(pkg) && isRecord(pkg['cairn'])) {
      return { file: `${pkgPath}#cairn`, raw: pkg['cairn'] }
    }
  }
  return null
}

/** Resolve one `extends` specifier (a path, relative to the file that references it) into
 * its own fully-resolved config, recursing into its own `extends` chain first. */
const resolveExtendsTarget = (cwd: string, specifier: string, fromFile: string): ResolvedConfig => {
  const resolved = path.isAbsolute(specifier) ? specifier : path.resolve(path.dirname(fromFile), specifier)
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `cairn: invalid config in ${fromFile}: extends target not found: ${specifier} (resolved to ${resolved})`,
    )
  }
  return resolveLayer(cwd, parseRcJson(fs.readFileSync(resolved, 'utf8'), resolved), resolved)
}

/** Decode one raw layer, fold in its own `extends` chain (base presets applied first, in
 * order, then this layer's own fields last), and return the fully-resolved result. */
const resolveLayer = (cwd: string, raw: unknown, file: string): ResolvedConfig => {
  const decoded = decodeConfig(raw, file)
  const specifiers =
    decoded.extends === undefined ? [] : Array.isArray(decoded.extends) ? decoded.extends : [decoded.extends]
  const withExtends = specifiers.reduce(
    (acc, specifier) => layerConfig(acc, resolveExtendsTarget(cwd, specifier, file)),
    DEFAULT_CONFIG,
  )
  return layerConfig(withExtends, decoded)
}

/** Load the resolved config: defaults <- extends chain <- file/package.json <- CLI overrides. */
export const loadConfig = (cwd: string, overrides: Overrides = {}, explicitPath?: string): ResolvedConfig => {
  const found = readRawConfig(cwd, explicitPath)
  const merged = found === null ? DEFAULT_CONFIG : resolveLayer(cwd, found.raw, found.file)
  return {
    ...merged,
    ...(overrides.locale === undefined ? {} : { locale: overrides.locale }),
    ...(overrides.roots === undefined || overrides.roots.length === 0 ? {} : { roots: overrides.roots }),
    ...(overrides.thresholdLines === undefined ? {} : { thresholdLines: overrides.thresholdLines }),
  }
}

const hasGlob = (segment: string): boolean => segment.includes('*') || segment.includes('?')

/** Expand one root pattern (relative to `cwd`) into existing absolute directories. */
const expandOne = (cwd: string, pattern: string): string[] => {
  const segments = pattern.split('/').filter((s) => s.length > 0)
  const isAbsolute = pattern.startsWith('/')
  let current = [isAbsolute ? '/' : cwd]
  for (const segment of segments) {
    const next: string[] = []
    for (const dir of current) {
      if (segment === '**') {
        // Match this directory and any descendant directory.
        next.push(dir, ...descendantDirs(dir))
        continue
      }
      if (!hasGlob(segment)) {
        next.push(path.join(dir, segment))
        continue
      }
      const re = globToRegExp(segment)
      for (const entry of readDirsSafe(dir)) {
        if (re.test(entry)) {
          next.push(path.join(dir, entry))
        }
      }
    }
    current = next
  }
  return current.filter(isDir)
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Never descend into these when expanding `**` — walking them is pointless and
// pathologically slow on real repositories.
const PRUNED_DIRS = new Set(['.git', 'node_modules'])

const readDirsSafe = (dir: string): string[] => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !PRUNED_DIRS.has(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
}

const descendantDirs = (dir: string): string[] => {
  const out: string[] = []
  for (const name of readDirsSafe(dir)) {
    const child = path.join(dir, name)
    out.push(child, ...descendantDirs(child))
  }
  return out
}

/** Resolve all configured roots to a de-duplicated list of existing directories (POSIX). */
export const expandRoots = (cwd: string, patterns: readonly string[]): string[] => {
  const seen = new Set<string>()
  for (const pattern of patterns) {
    for (const dir of expandOne(cwd, pattern)) {
      seen.add(toPosix(dir))
    }
  }
  return [...seen]
}
