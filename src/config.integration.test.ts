import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toPosix } from './core/paths.ts'
import { expandRoots } from './config.ts'

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
