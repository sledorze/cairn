import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import type { Effect, FileSystem } from 'effect'
import { Effect as Eff } from 'effect'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { toPosix } from './core/paths.ts'
import { DEFAULTS_SOURCE, expandRoots, loadConfig, loadConfigWithSource } from './config.ts'

// Exercises real-filesystem root-glob expansion, including the pruning of heavy
// directories (`node_modules`, `.git`) during `**` traversal. `config.ts` is
// Effect-based (`FileSystem`/`Path` services, matching `io/DocsFs.ts`'s own
// convention), so every call here runs through the real Node binding.
const run = <A>(eff: Effect.Effect<A, unknown, FileSystem.FileSystem>): Promise<A> =>
  Eff.runPromise(eff.pipe(Eff.provide(NodeServices.layer)))

let root = ''

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-roots-'))
  for (const dir of ['packages/alpha/docs', 'packages/beta/docs', 'node_modules/pkg/docs', '.git/docs']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
})

afterAll(() => {
  if (root) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe('expandRoots()', () => {
  it('expands a monorepo glob to the concrete doc directories', async () => {
    const rawDirs = await run(expandRoots(root, ['packages/*/docs']))
    const dirs = rawDirs.toSorted()
    expect(dirs).toEqual([
      toPosix(path.join(root, 'packages/alpha/docs')),
      toPosix(path.join(root, 'packages/beta/docs')),
    ])
  })

  it('prunes node_modules and .git when expanding `**`', async () => {
    const dirs = await run(expandRoots(root, ['**/docs']))
    expect(dirs.some((d) => d.includes('/node_modules/'))).toBeFalsy()
    expect(dirs.some((d) => d.includes('/.git/'))).toBeFalsy()
    expect(dirs.some((d) => d.endsWith('/packages/alpha/docs'))).toBeTruthy()
  })

  it('returns POSIX-separated paths', async () => {
    const dirs = await run(expandRoots(root, ['packages/alpha/docs']))
    expect(dirs[0]).not.toContain('\\')
  })

  // `readDirsSafe`'s own real-filesystem failure path — a glob segment
  // whose parent directory doesn't exist at all (as opposed to existing
  // but matching nothing) — never crashes, just yields no matches.
  it('resolves to an empty array (never throws) when a glob pattern is rooted under a directory that does not exist', async () => {
    await expect(run(expandRoots(root, ['nonexistent-dir/*']))).resolves.toEqual([])
  })

  // Adversarial finding, security-relevant (issue #92, closing PR #91's
  // reverted attempt): a `..`-free, non-absolute root pattern (e.g. the
  // literal default `"docs"`) can, BY CONSTRUCTION of `expandOne`'s own
  // literal-segment joins, only ever legitimately resolve to somewhere
  // under `cwd` — no config value can make it otherwise. If the directory
  // entry at that path is a SYMLINK whose real target escapes `cwd`
  // (git's own symlink mode 120000, planted by an untrusted PR), that
  // guarantee is violated at the filesystem level, not the config level —
  // this must be a loud, actionable error, not a silent scan of external
  // content NOR a silent empty roots list (indistinguishable from a
  // legitimately doc-free repo — the same "silently reads as success"
  // failure mode issue #63 already fixed once for a permission-denied
  // root).
  //
  // This is narrower and provably false-positive-free relative to PR #91's
  // reverted attempt: a pattern starting with `/` or containing a `..`
  // segment (e.g. `roots: ["../shared-docs"]`, a real, schema-supported
  // monorepo-sibling pattern) is explicitly EXCLUDED from this check below
  // — those patterns are SUPPOSED to be able to resolve outside `cwd`.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsSymlinks = process.platform !== 'win32' && !isRoot
  describe('a root pattern that can only legitimately resolve under `cwd` (no `..`, not absolute)', () => {
    it.skipIf(!supportsSymlinks)(
      'fails with a clear error when the resolved directory is a symlink escaping `cwd`',
      async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-root-escape-'))
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-root-escape-outside-'))
        try {
          fs.symlinkSync(outside, path.join(project, 'docs'), 'dir')
          await expect(run(expandRoots(project, ['docs']))).rejects.toThrow(/symlink/i)
        } finally {
          fs.rmSync(project, { force: true, recursive: true })
          fs.rmSync(outside, { force: true, recursive: true })
        }
      },
    )

    it.skipIf(!supportsSymlinks)(
      'does NOT fail when the resolved directory is a symlink staying inside `cwd`',
      async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-root-inside-'))
        try {
          fs.mkdirSync(path.join(project, 'real-docs'))
          fs.symlinkSync(path.join(project, 'real-docs'), path.join(project, 'docs'), 'dir')
          // Lexical path, not the resolved target — same convention every
          // other symlink-aware path in this codebase already returns.
          await expect(run(expandRoots(project, ['docs']))).resolves.toEqual([toPosix(path.join(project, 'docs'))])
        } finally {
          fs.rmSync(project, { force: true, recursive: true })
        }
      },
    )

    it('never fails for a plain, non-symlinked root — the overwhelmingly common case', async () => {
      await expect(run(expandRoots(root, ['packages/alpha/docs']))).resolves.not.toThrow()
    })
  })

  // The false-positive PR #91's reverted attempt introduced, now proven
  // fixed: a root pattern that's EXPLICITLY allowed to resolve outside
  // `cwd` (a leading `..` or `/`) must never be rejected, symlink or not.
  describe('a root pattern explicitly allowed to resolve outside `cwd` (`..` or absolute) is never checked', () => {
    it('a `..`-relative root pointing at a real sibling directory outside `cwd` is NOT rejected — the round-7-found regression case', async () => {
      const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-root-sibling-project-'))
      const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-root-sibling-docs-'))
      try {
        const cwd = path.join(project, 'consumer')
        fs.mkdirSync(cwd, { recursive: true })
        const relative = path.relative(cwd, sibling)
        await expect(run(expandRoots(cwd, [relative]))).resolves.toEqual([toPosix(sibling)])
      } finally {
        fs.rmSync(project, { force: true, recursive: true })
        fs.rmSync(sibling, { force: true, recursive: true })
      }
    })

    it('an absolute root outside cwd is never rejected', async () => {
      const absolute = toPosix(path.join(root, 'packages/alpha/docs'))
      await expect(run(expandRoots(root, [absolute]))).resolves.not.toThrow()
    })
  })
})

describe('loadConfig()', () => {
  let dir = ''

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  })

  const mkTmp = (prefix: string): string => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    return dir
  }

  it('applies an `extends` preset, with the local file taking precedence on shared keys', async () => {
    const cwd = mkTmp('cairn-extends-')
    fs.writeFileSync(
      path.join(cwd, 'base.cairnrc.json'),
      JSON.stringify({ checks: { links: false }, thresholdLines: 50 }),
    )
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ checks: { summaries: false }, extends: './base.cairnrc.json' }),
    )
    const config = await run(loadConfig(cwd))
    expect(config.thresholdLines).toBe(50) // inherited from the base preset
    expect(config.checks).toEqual({ coverage: null, links: false, summaries: false }) // deep-merged
    expect(config.roots).toEqual(['docs']) // untouched, falls through to the default
  })

  it('lets the local file override a value set by its `extends` preset', async () => {
    const cwd = mkTmp('cairn-extends-override-')
    fs.writeFileSync(path.join(cwd, 'base.cairnrc.json'), JSON.stringify({ thresholdLines: 50 }))
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ extends: './base.cairnrc.json', thresholdLines: 99 }),
    )
    const config = await run(loadConfig(cwd))
    expect(config.thresholdLines).toBe(99)
  })

  it('merges multiple `extends` array entries instead of the last one clobbering earlier ones', async () => {
    const cwd = mkTmp('cairn-extends-array-merge-')
    fs.writeFileSync(path.join(cwd, 'b.cairnrc.json'), JSON.stringify({ thresholdLines: 99 }))
    fs.writeFileSync(path.join(cwd, 'c.cairnrc.json'), JSON.stringify({ requireDirSummaries: false }))
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ extends: ['./b.cairnrc.json', './c.cairnrc.json'] }),
    )
    const config = await run(loadConfig(cwd))
    expect(config.thresholdLines).toBe(99) // from b — must survive c being merged in after it
    expect(config.requireDirSummaries).toBeFalsy() // from c
  })

  it('deep-merges `checks` across multiple `extends` array entries', async () => {
    const cwd = mkTmp('cairn-extends-array-checks-')
    fs.writeFileSync(path.join(cwd, 'b.cairnrc.json'), JSON.stringify({ checks: { links: false } }))
    fs.writeFileSync(path.join(cwd, 'c.cairnrc.json'), JSON.stringify({ checks: { summaries: false } }))
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ extends: ['./b.cairnrc.json', './c.cairnrc.json'] }),
    )
    const config = await run(loadConfig(cwd))
    expect(config.checks).toEqual({ coverage: null, links: false, summaries: false })
  })

  it('inherits `checks.coverage` from an `extends` preset when the local file does not set it', async () => {
    const cwd = mkTmp('cairn-extends-coverage-inherit-')
    fs.writeFileSync(
      path.join(cwd, 'base.cairnrc.json'),
      JSON.stringify({ checks: { coverage: { kinds: [], rules: [] } } }),
    )
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ checks: { links: false }, extends: './base.cairnrc.json' }),
    )
    const config = await run(loadConfig(cwd))
    expect(config.checks.coverage).toEqual({ exempt: [], kinds: [], rules: [] })
  })

  it('replaces (not merges) `checks.coverage` entirely when the local file also sets it', async () => {
    const cwd = mkTmp('cairn-extends-coverage-replace-')
    fs.writeFileSync(
      path.join(cwd, 'base.cairnrc.json'),
      JSON.stringify({
        checks: {
          coverage: {
            exempt: ['from-base/**'],
            kinds: [{ id: 'from-base', select: { by: 'path', glob: '*' } }],
            rules: [],
          },
        },
      }),
    )
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({
        checks: { coverage: { kinds: [{ id: 'from-local', select: { by: 'path', glob: '*' } }], rules: [] } },
        extends: './base.cairnrc.json',
      }),
    )
    // The local layer's coverage block wins WHOLESALE — no trace of the
    // base's kinds/exempt survives, unlike `links`/`summaries`' own `??`
    // (field-by-field) precedence just above.
    const config = await run(loadConfig(cwd))
    expect(config.checks.coverage).toEqual({
      exempt: [],
      kinds: [{ id: 'from-local', select: { by: 'path', glob: '*' } }],
      rules: [],
    })
  })

  it('re-disables `checks.coverage` with `false` when a local config overrides an `extends` preset that enabled it', async () => {
    const cwd = mkTmp('cairn-extends-coverage-disable-')
    fs.writeFileSync(
      path.join(cwd, 'base.cairnrc.json'),
      JSON.stringify({ checks: { coverage: { kinds: [{ id: 'x', select: { by: 'path', glob: '*' } }], rules: [] } } }),
    )
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ checks: { coverage: false }, extends: './base.cairnrc.json' }),
    )
    const config = await run(loadConfig(cwd))
    expect(config.checks.coverage).toBeNull()
  })

  // Adversarial finding: every other `checks.coverage: false` test exercises
  // it ONLY in combination with an `extends` preset that first enables
  // coverage — the plain top-level case (no `extends` at all) was verified
  // correct by code inspection (DEFAULT_CONFIG.checks.coverage is already
  // `null`, so this converges with the "never enabled" case either way) but
  // left untested, a real gap a future edit to layerConfig's three-way
  // check could regress silently.
  it('resolves `checks.coverage: false` to null with no `extends` involved at all', async () => {
    const cwd = mkTmp('cairn-coverage-disable-no-extends-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ checks: { coverage: false } }))
    const config = await run(loadConfig(cwd))
    expect(config.checks.coverage).toBeNull()
  })

  it('resolves diamond-shaped `extends` (two siblings sharing a base) without a false-positive cycle', async () => {
    const cwd = mkTmp('cairn-extends-diamond-')
    fs.writeFileSync(path.join(cwd, 'shared.cairnrc.json'), JSON.stringify({ locale: 'fr' }))
    fs.writeFileSync(
      path.join(cwd, 'a.cairnrc.json'),
      JSON.stringify({ extends: './shared.cairnrc.json', thresholdLines: 11 }),
    )
    fs.writeFileSync(
      path.join(cwd, 'b.cairnrc.json'),
      JSON.stringify({ extends: './shared.cairnrc.json', thresholdLines: 22 }),
    )
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ extends: ['./a.cairnrc.json', './b.cairnrc.json'] }),
    )
    const config = await run(loadConfig(cwd))
    expect(config.locale).toBe('fr') // inherited via both branches
    expect(config.thresholdLines).toBe(22) // b resolved after a, so b wins
  })

  it('throws a clear error when an `extends` target does not exist', async () => {
    const cwd = mkTmp('cairn-extends-missing-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './missing.json' }))
    await expect(run(loadConfig(cwd))).rejects.toThrow(/extends target not found/)
  })

  it('throws a clear error on a self-referencing `extends` instead of overflowing the stack', async () => {
    const cwd = mkTmp('cairn-extends-self-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './.cairnrc.json' }))
    await expect(run(loadConfig(cwd))).rejects.toThrow(/circular extends/)
  })

  it('throws a clear error on a two-file `extends` cycle instead of overflowing the stack', async () => {
    const cwd = mkTmp('cairn-extends-cycle-')
    fs.writeFileSync(path.join(cwd, 'a.cairnrc.json'), JSON.stringify({ extends: './b.cairnrc.json' }))
    fs.writeFileSync(path.join(cwd, 'b.cairnrc.json'), JSON.stringify({ extends: './a.cairnrc.json' }))
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './a.cairnrc.json' }))
    await expect(run(loadConfig(cwd))).rejects.toThrow(/circular extends/)
  })

  it('resolves a chain of `extends` (base presets applied before the extending file)', async () => {
    const cwd = mkTmp('cairn-extends-chain-')
    fs.writeFileSync(path.join(cwd, 'root.cairnrc.json'), JSON.stringify({ locale: 'fr', thresholdLines: 10 }))
    fs.writeFileSync(
      path.join(cwd, 'mid.cairnrc.json'),
      JSON.stringify({ extends: './root.cairnrc.json', thresholdLines: 20 }),
    )
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './mid.cairnrc.json' }))
    const config = await run(loadConfig(cwd))
    expect(config.thresholdLines).toBe(20) // mid overrides root
    expect(config.locale).toBe('fr') // inherited all the way from root
  })

  it('falls back to the package.json "cairn" key when no rc file exists', async () => {
    const cwd = mkTmp('cairn-pkg-')
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ cairn: { thresholdLines: 42 } }))
    const config = await run(loadConfig(cwd))
    expect(config.thresholdLines).toBe(42)
  })

  it('rejects an unknown key with a clear error naming the offending file', async () => {
    const cwd = mkTmp('cairn-bad-key-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ thresholdLins: 10 }))
    await expect(run(loadConfig(cwd))).rejects.toThrow(/invalid config in.*\.cairnrc\.json/)
  })
})

describe('loadConfigWithSource()', () => {
  let dir = ''

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  })

  const mkTmp = (prefix: string): string => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    return dir
  }

  it('reports the rc file as the source', async () => {
    const cwd = mkTmp('cairn-source-rc-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ thresholdLines: 5 }))
    const { config, sourceFile } = await run(loadConfigWithSource(cwd))
    expect(sourceFile).toBe(path.join(cwd, '.cairnrc.json'))
    expect(config.thresholdLines).toBe(5)
  })

  it('reports `<package.json>#cairn` as the source when falling back to package.json', async () => {
    const cwd = mkTmp('cairn-source-pkg-')
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ cairn: { thresholdLines: 42 } }))
    const { sourceFile } = await run(loadConfigWithSource(cwd))
    expect(sourceFile).toBe(`${path.join(cwd, 'package.json')}#cairn`)
  })

  it('reports the defaults source when no config is found at all', async () => {
    const cwd = mkTmp('cairn-source-defaults-')
    const { config, sourceFile } = await run(loadConfigWithSource(cwd))
    expect(sourceFile).toBe(DEFAULTS_SOURCE)
    expect(config.thresholdLines).toBe(30)
  })
})
