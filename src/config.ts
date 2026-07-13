// Configuration loading & root-glob expansion for the CLI. This is the Node
// (impure) edge of the tool: it reads `.cairnrc(.json)` or the
// `cairn` key of `package.json`, merges with defaults, and expands
// `roots` globs to concrete directories. The pure planners never see this — they
// receive already-resolved values.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Naming } from './core/DocSummaries.ts'
import { DEFAULT_NAMING, DEFAULT_THRESHOLD_LINES } from './core/DocSummaries.ts'
import { globToRegExp } from './core/glob.ts'
import { toPosix } from './core/paths.ts'
import { DEFAULT_STAMP_COMMAND } from './program/CheckSummaries.ts'
import type { Locale } from './program/locale.ts'

export interface ChecksConfig {
  readonly links: boolean
  readonly summaries: boolean
}

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

const asStringArray = (v: unknown): readonly string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined

/** Merge a parsed (untrusted) config object over the defaults. */
export const mergeConfig = (raw: unknown, base: ResolvedConfig = DEFAULT_CONFIG): ResolvedConfig => {
  if (!isRecord(raw)) {
    return base
  }
  const naming = isRecord(raw['naming']) ? raw['naming'] : {}
  const checks = isRecord(raw['checks']) ? raw['checks'] : {}
  return {
    checks: {
      links: typeof checks['links'] === 'boolean' ? checks['links'] : base.checks.links,
      summaries: typeof checks['summaries'] === 'boolean' ? checks['summaries'] : base.checks.summaries,
    },
    ignore: asStringArray(raw['ignore']) ?? base.ignore,
    locale: raw['locale'] === 'fr' || raw['locale'] === 'en' ? raw['locale'] : base.locale,
    naming: {
      dirSummary: typeof naming['dirSummary'] === 'string' ? naming['dirSummary'] : base.naming.dirSummary,
      fileSummarySuffix:
        typeof naming['fileSummarySuffix'] === 'string' ? naming['fileSummarySuffix'] : base.naming.fileSummarySuffix,
    },
    requireDirSummaries:
      typeof raw['requireDirSummaries'] === 'boolean' ? raw['requireDirSummaries'] : base.requireDirSummaries,
    roots: asStringArray(raw['roots']) ?? base.roots,
    stampCommand: typeof raw['stampCommand'] === 'string' ? raw['stampCommand'] : base.stampCommand,
    thresholdLines: typeof raw['thresholdLines'] === 'number' ? raw['thresholdLines'] : base.thresholdLines,
  }
}

const CONFIG_FILENAMES = ['.cairnrc.json', '.cairnrc']

/** Parse JSON, turning a syntax error into a clear, actionable message. */
export const parseRcJson = (text: string, file: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`cairn: invalid JSON in ${file}: ${(error as Error).message}`, { cause: error })
  }
}

/** Read raw config from a rc file, the package.json key, or null. */
const readRawConfig = (cwd: string, explicitPath?: string): unknown => {
  const candidates = explicitPath ? [path.resolve(cwd, explicitPath)] : CONFIG_FILENAMES.map((f) => path.join(cwd, f))
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return parseRcJson(fs.readFileSync(file, 'utf8'), file)
    }
  }
  const pkgPath = path.join(cwd, 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pkg = parseRcJson(fs.readFileSync(pkgPath, 'utf8'), pkgPath)
    if (isRecord(pkg) && isRecord(pkg['cairn'])) {
      return pkg['cairn']
    }
  }
  return null
}

/** Load the resolved config: defaults <- file/package.json <- CLI overrides. */
export const loadConfig = (cwd: string, overrides: Overrides = {}, explicitPath?: string): ResolvedConfig => {
  const merged = mergeConfig(readRawConfig(cwd, explicitPath))
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
