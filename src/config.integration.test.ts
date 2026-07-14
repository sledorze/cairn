import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { toPosix } from './core/paths.ts'
import { DEFAULTS_SOURCE, expandRoots, loadConfig, loadConfigWithSource } from './config.ts'

// Exercises real-filesystem root-glob expansion, including the pruning of heavy
// directories (`node_modules`, `.git`) during `**` traversal.

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
  it('expands a monorepo glob to the concrete doc directories', () => {
    const dirs = expandRoots(root, ['packages/*/docs']).toSorted()
    expect(dirs).toEqual([
      toPosix(path.join(root, 'packages/alpha/docs')),
      toPosix(path.join(root, 'packages/beta/docs')),
    ])
  })

  it('prunes node_modules and .git when expanding `**`', () => {
    const dirs = expandRoots(root, ['**/docs'])
    expect(dirs.some((d) => d.includes('/node_modules/'))).toBeFalsy()
    expect(dirs.some((d) => d.includes('/.git/'))).toBeFalsy()
    expect(dirs.some((d) => d.endsWith('/packages/alpha/docs'))).toBeTruthy()
  })

  it('returns POSIX-separated paths', () => {
    const dirs = expandRoots(root, ['packages/alpha/docs'])
    expect(dirs[0]).not.toContain('\\')
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

  it('applies an `extends` preset, with the local file taking precedence on shared keys', () => {
    const cwd = mkTmp('cairn-extends-')
    fs.writeFileSync(
      path.join(cwd, 'base.cairnrc.json'),
      JSON.stringify({ checks: { links: false }, thresholdLines: 50 }),
    )
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ checks: { summaries: false }, extends: './base.cairnrc.json' }),
    )
    const config = loadConfig(cwd)
    expect(config.thresholdLines).toBe(50) // inherited from the base preset
    expect(config.checks).toEqual({ links: false, summaries: false }) // deep-merged
    expect(config.roots).toEqual(['docs']) // untouched, falls through to the default
  })

  it('lets the local file override a value set by its `extends` preset', () => {
    const cwd = mkTmp('cairn-extends-override-')
    fs.writeFileSync(path.join(cwd, 'base.cairnrc.json'), JSON.stringify({ thresholdLines: 50 }))
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ extends: './base.cairnrc.json', thresholdLines: 99 }),
    )
    expect(loadConfig(cwd).thresholdLines).toBe(99)
  })

  it('merges multiple `extends` array entries instead of the last one clobbering earlier ones', () => {
    const cwd = mkTmp('cairn-extends-array-merge-')
    fs.writeFileSync(path.join(cwd, 'b.cairnrc.json'), JSON.stringify({ thresholdLines: 99 }))
    fs.writeFileSync(path.join(cwd, 'c.cairnrc.json'), JSON.stringify({ requireDirSummaries: false }))
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ extends: ['./b.cairnrc.json', './c.cairnrc.json'] }),
    )
    const config = loadConfig(cwd)
    expect(config.thresholdLines).toBe(99) // from b — must survive c being merged in after it
    expect(config.requireDirSummaries).toBeFalsy() // from c
  })

  it('deep-merges `checks` across multiple `extends` array entries', () => {
    const cwd = mkTmp('cairn-extends-array-checks-')
    fs.writeFileSync(path.join(cwd, 'b.cairnrc.json'), JSON.stringify({ checks: { links: false } }))
    fs.writeFileSync(path.join(cwd, 'c.cairnrc.json'), JSON.stringify({ checks: { summaries: false } }))
    fs.writeFileSync(
      path.join(cwd, '.cairnrc.json'),
      JSON.stringify({ extends: ['./b.cairnrc.json', './c.cairnrc.json'] }),
    )
    expect(loadConfig(cwd).checks).toEqual({ links: false, summaries: false })
  })

  it('resolves diamond-shaped `extends` (two siblings sharing a base) without a false-positive cycle', () => {
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
    const config = loadConfig(cwd)
    expect(config.locale).toBe('fr') // inherited via both branches
    expect(config.thresholdLines).toBe(22) // b resolved after a, so b wins
  })

  it('throws a clear error when an `extends` target does not exist', () => {
    const cwd = mkTmp('cairn-extends-missing-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './missing.json' }))
    expect(() => loadConfig(cwd)).toThrow(/extends target not found/)
  })

  it('throws a clear error on a self-referencing `extends` instead of overflowing the stack', () => {
    const cwd = mkTmp('cairn-extends-self-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './.cairnrc.json' }))
    expect(() => loadConfig(cwd)).toThrow(/circular extends/)
  })

  it('throws a clear error on a two-file `extends` cycle instead of overflowing the stack', () => {
    const cwd = mkTmp('cairn-extends-cycle-')
    fs.writeFileSync(path.join(cwd, 'a.cairnrc.json'), JSON.stringify({ extends: './b.cairnrc.json' }))
    fs.writeFileSync(path.join(cwd, 'b.cairnrc.json'), JSON.stringify({ extends: './a.cairnrc.json' }))
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './a.cairnrc.json' }))
    expect(() => loadConfig(cwd)).toThrow(/circular extends/)
  })

  it('resolves a chain of `extends` (base presets applied before the extending file)', () => {
    const cwd = mkTmp('cairn-extends-chain-')
    fs.writeFileSync(path.join(cwd, 'root.cairnrc.json'), JSON.stringify({ locale: 'fr', thresholdLines: 10 }))
    fs.writeFileSync(
      path.join(cwd, 'mid.cairnrc.json'),
      JSON.stringify({ extends: './root.cairnrc.json', thresholdLines: 20 }),
    )
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ extends: './mid.cairnrc.json' }))
    const config = loadConfig(cwd)
    expect(config.thresholdLines).toBe(20) // mid overrides root
    expect(config.locale).toBe('fr') // inherited all the way from root
  })

  it('falls back to the package.json "cairn" key when no rc file exists', () => {
    const cwd = mkTmp('cairn-pkg-')
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ cairn: { thresholdLines: 42 } }))
    expect(loadConfig(cwd).thresholdLines).toBe(42)
  })

  it('rejects an unknown key with a clear error naming the offending file', () => {
    const cwd = mkTmp('cairn-bad-key-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ thresholdLins: 10 }))
    expect(() => loadConfig(cwd)).toThrow(/invalid config in.*\.cairnrc\.json/)
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

  it('reports the rc file as the source', () => {
    const cwd = mkTmp('cairn-source-rc-')
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), JSON.stringify({ thresholdLines: 5 }))
    const { config, sourceFile } = loadConfigWithSource(cwd)
    expect(sourceFile).toBe(path.join(cwd, '.cairnrc.json'))
    expect(config.thresholdLines).toBe(5)
  })

  it('reports `<package.json>#cairn` as the source when falling back to package.json', () => {
    const cwd = mkTmp('cairn-source-pkg-')
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ cairn: { thresholdLines: 42 } }))
    const { sourceFile } = loadConfigWithSource(cwd)
    expect(sourceFile).toBe(`${path.join(cwd, 'package.json')}#cairn`)
  })

  it('reports the defaults source when no config is found at all', () => {
    const cwd = mkTmp('cairn-source-defaults-')
    const { config, sourceFile } = loadConfigWithSource(cwd)
    expect(sourceFile).toBe(DEFAULTS_SOURCE)
    expect(config.thresholdLines).toBe(30)
  })
})
