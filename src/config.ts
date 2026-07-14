// Configuration loading & root-glob expansion for the CLI. This is the Node
// (impure) edge of the tool: it reads `.cairnrc(.json)` or the
// `cairn` key of `package.json` from disk, decodes it via the pure `core/Config.ts`
// schema, resolves `extends` chains (also disk IO), and expands `roots` globs to
// concrete directories. The pure planners never see this — they receive
// already-resolved values.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Overrides, ResolvedConfig } from './core/Config.ts'
import { DEFAULT_CONFIG, decodeConfig, layerConfig } from './core/Config.ts'
import { globToRegExp } from './core/glob.ts'
import { toPosix } from './core/paths.ts'

export type { CairnConfigInput, ChecksConfig, Locale, Overrides, ResolvedConfig } from './core/Config.ts'
export { CairnConfigSchema, DEFAULT_CONFIG, decodeConfig } from './core/Config.ts'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

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
 * its own fully-resolved config, recursing into its own `extends` chain first. `visited`
 * (resolved absolute paths of every file in the chain so far) guards against a cycle —
 * without it, `a` extends `b` extends `a` would recurse until the call stack overflows. */
const resolveExtendsTarget = (
  cwd: string,
  specifier: string,
  fromFile: string,
  visited: readonly string[],
): ResolvedConfig => {
  const resolved = path.isAbsolute(specifier) ? specifier : path.resolve(path.dirname(fromFile), specifier)
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `cairn: invalid config in ${fromFile}: extends target not found: ${specifier} (resolved to ${resolved})`,
    )
  }
  if (visited.includes(resolved)) {
    throw new Error(`cairn: invalid config in ${fromFile}: circular extends: ${[...visited, resolved].join(' -> ')}`)
  }
  return resolveLayer(cwd, parseRcJson(fs.readFileSync(resolved, 'utf8'), resolved), resolved, visited)
}

/** Decode one raw layer, fold in its own `extends` chain (base presets applied first, in
 * order, then this layer's own fields last), and return the fully-resolved result. */
const resolveLayer = (cwd: string, raw: unknown, file: string, visited: readonly string[] = []): ResolvedConfig => {
  const decoded = decodeConfig(raw, file)
  const specifiers =
    decoded.extends === undefined ? [] : Array.isArray(decoded.extends) ? decoded.extends : [decoded.extends]
  const nextVisited = [...visited, file]
  const withExtends = specifiers.reduce(
    (acc, specifier) => layerConfig(acc, resolveExtendsTarget(cwd, specifier, file, nextVisited)),
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
