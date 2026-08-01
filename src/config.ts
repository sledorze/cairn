// Configuration loading & root-glob expansion for the CLI. This is the Node
// (impure) edge of the tool: it reads `.cairnrc(.json)` or the
// `cairn` key of `package.json` from disk, decodes it via the pure `core/Config.ts`
// schema, resolves `extends` chains (also disk IO), and expands `roots` globs to
// concrete directories. The pure planners never see this — they receive
// already-resolved values.
//
// Effect-based (not raw `node:fs`), consistent with `io/DocsFs.ts`'s own
// convention: real filesystem access goes through the `FileSystem`/`Path`
// services, so this module is exercised against the same real Node binding
// (`NodeServices.layer`) every other IO-touching module in this codebase
// already is. `readDirsSafe` is the one exception (`Effect.tryPromise`
// wrapping `node:fs/promises` directly): `FileSystem.readDirectory` returns
// bare names with no Dirent-style type info, the exact reason `DocsFs.ts`'s
// own `walk()` falls back to raw `NodeFsPromises.readdir` too. Pure
// path-string manipulation (`path.join`/`path.dirname`/`path.isAbsolute`)
// stays on `node:path` directly — those are deterministic string operations
// with no IO, same as every other pure module in this codebase (e.g.
// `Coverage.ts`) that reasons in `node:path` without going through Effect's
// `Path` service for it.

import type { Dirent } from 'node:fs'
import * as NodeFsPromises from 'node:fs/promises'
import * as path from 'node:path'

import { Effect, FileSystem, Result } from 'effect'

import type { Overrides, ResolvedConfig } from './core/Config.ts'
import { DEFAULT_CONFIG, decodeConfig, formatConfigError, layerConfig } from './core/Config.ts'
import { globToRegExp } from './core/glob.ts'
import { isWithinBase, toPosix } from './core/paths.ts'

export type { CairnConfigInput, ChecksConfig, Locale, Overrides, ResolvedConfig } from './core/Config.ts'
export { CairnConfigSchema, DEFAULT_CONFIG, decodeConfig, formatConfigError, LOCALES } from './core/Config.ts'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const CONFIG_FILENAMES = ['.cairnrc.json', '.cairnrc']

/** Parse JSON, turning a syntax error into a clear, actionable message. Pure
 * — no IO — so it stays a plain throwing function rather than an Effect;
 * every caller already runs inside an Effect context that can catch it. */
export const parseRcJson = (text: string, file: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`cairn: invalid JSON in ${file}: ${(error as Error).message}`, { cause: error })
  }
}

/** Read the raw config plus the file it came from: an rc file, the package.json key, or null. */
const readRawConfig = (
  cwd: string,
  explicitPath?: string,
): Effect.Effect<{ readonly file: string; readonly raw: unknown } | null, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const candidates = explicitPath ? [path.resolve(cwd, explicitPath)] : CONFIG_FILENAMES.map((f) => path.join(cwd, f))
    for (const file of candidates) {
      if (yield* fs.exists(file)) {
        const text = yield* fs.readFileString(file)
        return { file, raw: parseRcJson(text, file) }
      }
    }
    const pkgPath = path.join(cwd, 'package.json')
    if (yield* fs.exists(pkgPath)) {
      const text = yield* fs.readFileString(pkgPath)
      const pkg = parseRcJson(text, pkgPath)
      if (isRecord(pkg) && isRecord(pkg['cairn'])) {
        return { file: `${pkgPath}#cairn`, raw: pkg['cairn'] }
      }
    }
    return null
  })

/** Resolve one `extends` specifier (a path, relative to the file that references it),
 * folding it onto `acc` — the single running accumulator threaded through the *entire*
 * resolution — and return the updated accumulator. `visited` (resolved absolute paths of
 * every file in the chain so far) guards against a cycle: without it, `a` extends `b`
 * extends `a` would recurse until the call stack overflows.
 *
 * Threading one accumulator (rather than resolving each `extends` target independently
 * against `DEFAULT_CONFIG` and merging the fully-resolved results together) matters for
 * correctness, not just style: a fully-resolved `ResolvedConfig` has every field
 * populated — including fields a given target never actually set, now holding *its own*
 * defaults — so merging two such snapshots together makes the second silently clobber
 * every field the first one set, not just the ones it overrides. Every field assignment
 * here instead goes through `layerConfig(acc, decoded)`, where `decoded` is always a
 * genuine partial `CairnConfigInput` (only the fields that file actually specified), so
 * "unset" and "set to the default" stay distinguishable all the way through. */
const resolveExtendsTarget = (
  cwd: string,
  specifier: string,
  fromFile: string,
  visited: readonly string[],
  acc: ResolvedConfig,
): Effect.Effect<ResolvedConfig, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fsService = yield* FileSystem.FileSystem
    const resolved = path.isAbsolute(specifier) ? specifier : path.resolve(path.dirname(fromFile), specifier)
    if (!(yield* fsService.exists(resolved))) {
      return yield* Effect.fail(
        new Error(
          `cairn: invalid config in ${fromFile}: extends target not found: ${specifier} (resolved to ${resolved})`,
        ),
      )
    }
    if (visited.includes(resolved)) {
      return yield* Effect.fail(
        new Error(`cairn: invalid config in ${fromFile}: circular extends: ${[...visited, resolved].join(' -> ')}`),
      )
    }
    const text = yield* fsService.readFileString(resolved)
    return yield* resolveLayer(cwd, parseRcJson(text, resolved), resolved, visited, acc)
  })

/** Decode one raw layer, fold in its own `extends` chain (base presets applied first, in
 * order, onto `acc`, then this layer's own fields last), and return the updated
 * accumulator. `decodeConfig` is pure and total (it returns a `Failure` on failure, never
 * throws) — the edge is where that `Failure` becomes a failed Effect with a
 * human-readable message. */
const resolveLayer = (
  cwd: string,
  raw: unknown,
  file: string,
  visited: readonly string[] = [],
  acc: ResolvedConfig = DEFAULT_CONFIG,
): Effect.Effect<ResolvedConfig, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const result = decodeConfig(raw)
    if (Result.isFailure(result)) {
      return yield* Effect.fail(new Error(formatConfigError(result.failure, file)))
    }
    const decoded = result.success
    const nextVisited = [...visited, file]
    let withExtends = acc
    for (const specifier of decoded.extends ?? []) {
      withExtends = yield* resolveExtendsTarget(cwd, specifier, file, nextVisited, withExtends)
    }
    return layerConfig(withExtends, decoded)
  })

export interface ResolvedConfigWithSource {
  readonly config: ResolvedConfig
  readonly sourceFile: string
}

/** Shown as provenance when no `.cairnrc(.json)` or `package.json#cairn` was found. */
export const DEFAULTS_SOURCE = 'defaults (no config found)'

/** Load the resolved config: defaults <- extends chain <- file/package.json <- CLI overrides,
 * plus which file it came from (an rc file, `<package.json>#cairn`, or `DEFAULTS_SOURCE`).
 * Powers the `cairn config` debug command's "why aren't my docs being checked" answer. */
export const loadConfigWithSource = (
  cwd: string,
  overrides: Overrides = {},
  explicitPath?: string,
): Effect.Effect<ResolvedConfigWithSource, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const found = yield* readRawConfig(cwd, explicitPath)
    const merged = found === null ? DEFAULT_CONFIG : yield* resolveLayer(cwd, found.raw, found.file)
    const config: ResolvedConfig = {
      ...merged,
      ...(overrides.locale === undefined ? {} : { locale: overrides.locale }),
      ...(overrides.roots === undefined || overrides.roots.length === 0 ? {} : { roots: overrides.roots }),
      ...(overrides.thresholdLines === undefined ? {} : { thresholdLines: overrides.thresholdLines }),
    }
    return { config, sourceFile: found?.file ?? DEFAULTS_SOURCE }
  })

/** Load just the resolved config: defaults <- extends chain <- file/package.json <- CLI overrides. */
export const loadConfig = (
  cwd: string,
  overrides: Overrides = {},
  explicitPath?: string,
): Effect.Effect<ResolvedConfig, unknown, FileSystem.FileSystem> =>
  loadConfigWithSource(cwd, overrides, explicitPath).pipe(Effect.map(({ config }) => config))

const hasGlob = (segment: string): boolean => segment.includes('*') || segment.includes('?')

/** Expand one root pattern (relative to `cwd`) into existing absolute directories. */
const expandOne = (cwd: string, pattern: string): Effect.Effect<string[], unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const segments = pattern.split('/').filter((s) => s.length > 0)
    const isAbsolute = pattern.startsWith('/')
    let current = [isAbsolute ? '/' : cwd]
    for (const segment of segments) {
      const next: string[] = []
      for (const dir of current) {
        if (segment === '**') {
          // Match this directory and any descendant directory.
          next.push(dir, ...(yield* descendantDirs(dir)))
          continue
        }
        if (!hasGlob(segment)) {
          next.push(path.join(dir, segment))
          continue
        }
        const re = globToRegExp(segment)
        for (const entry of yield* readDirsSafe(dir)) {
          if (re.test(entry)) {
            next.push(path.join(dir, entry))
          }
        }
      }
      current = next
    }
    const dirs: string[] = []
    for (const p of current) {
      if (yield* isDir(p)) {
        dirs.push(p)
      }
    }
    yield* assertNoRootEscape(cwd, pattern, dirs)
    return dirs
  })

const isDir = (p: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(p).pipe(Effect.catch(() => Effect.succeed(null)))
    return info !== null && info.type === 'Directory'
  })

/**
 * A root PATTERN with no leading `/` and no `..` segment can, by
 * construction of `expandOne`'s own literal/glob joins above, only ever
 * legitimately resolve to somewhere under `cwd` — no config value can make
 * it otherwise. If the directory `expandOne` resolved for such a pattern
 * turns out to be a SYMLINK whose real target escapes `cwd`, that
 * guarantee was violated at the FILESYSTEM level (a directory entry
 * replaced by a symlink between commits, e.g. via git's own symlink mode
 * `120000` in an untrusted PR) — a loud, actionable error, never a silent
 * scan of external content and never a silent empty roots list either (an
 * empty result reads as "nothing to scan," indistinguishable from a
 * legitimately doc-free repo — the same "silently reads as success"
 * failure mode issue #63 already fixed once, for a permission-denied
 * root).
 *
 * Deliberately narrower than the reverted attempt in PR #91 (see issue
 * #92): a pattern starting with `/` or containing a `..` segment (e.g.
 * `roots: ["../shared-docs"]`, a real, schema-supported monorepo-sibling
 * pattern) is explicitly exempt — those patterns are SUPPOSED to be able
 * to resolve outside `cwd`, and checking them against `cwd` is exactly
 * the false-positive PR #91's reverted fix introduced.
 */
const assertNoRootEscape = (
  cwd: string,
  pattern: string,
  dirs: readonly string[],
): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (pattern.startsWith('/') || pattern.split('/').includes('..')) {
      return
    }
    const fs = yield* FileSystem.FileSystem
    for (const dir of dirs) {
      // A `null` real path (unresolvable) is already excluded by `isDir`'s
      // own existence check above — nothing new to report here.
      const real = yield* fs.realPath(dir).pipe(Effect.catch(() => Effect.succeed(null)))
      if (real === null) {
        continue
      }
      if (!isWithinBase(toPosix(real), toPosix(cwd))) {
        yield* Effect.fail(
          new Error(
            `cairn: root "${pattern}" resolves to "${toPosix(dir)}", a symlink pointing OUTSIDE the project directory (real location: "${toPosix(real)}"). This pattern can only legitimately resolve under "${toPosix(cwd)}" — either the directory was replaced by a symlink, or (if this is intentional) express it with a "../" or absolute path instead, which cairn already allows to resolve outside the project.`,
          ),
        )
      }
    }
  })

// Never descend into these when expanding `**` — walking them is pointless and
// pathologically slow on real repositories.
const PRUNED_DIRS = new Set(['.git', 'node_modules'])

/** `FileSystem.readDirectory` returns bare names (no Dirent-style type info)
 * — the same gap `io/DocsFs.ts`'s own `walk()` works around — so this falls
 * back to raw `node:fs/promises` directly, wrapped in `Effect.tryPromise`. */
const readDirsSafe = (dir: string): Effect.Effect<string[], never, never> =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: () => NodeFsPromises.readdir(dir, { withFileTypes: true }),
  }).pipe(
    Effect.catch(() => Effect.succeed<Dirent[]>([])),
    Effect.map((entries) => entries.filter((e) => e.isDirectory() && !PRUNED_DIRS.has(e.name)).map((e) => e.name)),
  )

const descendantDirs = (dir: string): Effect.Effect<string[], never, never> =>
  Effect.gen(function* () {
    const out: string[] = []
    for (const name of yield* readDirsSafe(dir)) {
      const child = path.join(dir, name)
      out.push(child, ...(yield* descendantDirs(child)))
    }
    return out
  })

/** Resolve all configured roots to a de-duplicated list of existing directories (POSIX). */
export const expandRoots = (
  cwd: string,
  patterns: readonly string[],
): Effect.Effect<string[], unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const seen = new Set<string>()
    for (const pattern of patterns) {
      for (const dir of yield* expandOne(cwd, pattern)) {
        seen.add(toPosix(dir))
      }
    }
    return [...seen]
  })
