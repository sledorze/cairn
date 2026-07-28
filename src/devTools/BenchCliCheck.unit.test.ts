import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  appendSyntheticBenchEntry,
  buildCheckFixture,
  decodeReport,
  DECISION_COUNT,
  FEATURE_COUNT,
  resolveAbsoluteCliPath,
} from './BenchCliCheck.ts'

describe('the bench-check fixture', () => {
  it('writes a self-consistent fixture: every feature links to a real decision, none orphaned', () => {
    const root = buildCheckFixture()
    try {
      const decisionIds = new Set(Array.from({ length: DECISION_COUNT }, (_, i) => i))
      for (let i = 0; i < FEATURE_COUNT; i++) {
        const body = fs.readFileSync(path.join(root, `product/features/${i}.md`), 'utf8')
        const match = /docs\/adr\/(\d+)\.md/.exec(body)
        expect(match).not.toBeNull()
        const decisionId = match ? Number(match[1]) : Number.NaN
        expect(decisionIds.has(decisionId)).toBeTruthy()
      }
      for (let i = 0; i < DECISION_COUNT; i++) {
        expect(fs.existsSync(path.join(root, `docs/adr/${i}.md`))).toBeTruthy()
        expect(fs.readFileSync(path.join(root, `docs/adr/${i}.md`), 'utf8')).toContain(`# Decision ${i}`)
      }
      // Exactly DECISION_COUNT/FEATURE_COUNT files, not off-by-one in either
      // direction — a `<` -> `<=` mutation in the fixture's own build loop would
      // silently write one extra (orphan-free-by-luck) doc past either range.
      expect(fs.readdirSync(path.join(root, 'docs/adr'))).toHaveLength(DECISION_COUNT)
      expect(fs.readdirSync(path.join(root, 'product/features'))).toHaveLength(FEATURE_COUNT)
      const config = JSON.parse(fs.readFileSync(path.join(root, '.cairnrc.json'), 'utf8')) as {
        checks: {
          coverage: {
            kinds: { id: string; select: { by: string; glob: string } }[]
            rules: { from: string; to: string }[]
          }
        }
        requireDirSummaries: boolean
        roots: string[]
      }
      expect(config.checks.coverage.kinds).toEqual([
        { id: 'feature', select: { by: 'path', glob: '**/product/features/**' } },
        { id: 'decision', select: { by: 'path', glob: '**/docs/adr/**' } },
      ])
      expect(config.checks.coverage.rules).toEqual([{ from: 'feature', to: 'decision' }])
      expect(config.requireDirSummaries).toBeFalsy()
      expect(config.roots).toEqual(['docs', 'product'])
    } finally {
      fs.rmSync(root, { force: true, recursive: true })
    }
  })
})

describe('resolving the CLI path to bench', () => {
  it('resolves a relative path against process.cwd(), not against any spawn-time cwd', () => {
    const relative = 'dist/cli.js'
    expect(resolveAbsoluteCliPath(relative)).toBe(path.resolve(process.cwd(), relative))
  })

  it('leaves an already-absolute path unchanged', () => {
    const absolute = path.resolve('/tmp/some/dist/cli.js')
    expect(resolveAbsoluteCliPath(absolute)).toBe(absolute)
  })
})

describe('decoding a bench report', () => {
  it('decodes a well-formed vitest bench report', () => {
    const raw = {
      files: [{ filepath: 'a.bench.ts', groups: [{ benchmarks: [{ mean: 1.5, name: 'x' }], fullName: 'g' }] }],
    }
    expect(decodeReport(raw)).toEqual(raw)
  })

  it('throws a Schema decode error, not a silent pass-through, when the shape does not match', () => {
    expect(() => decodeReport({ files: [{ filepath: 'a.bench.ts' }] })).toThrow(/groups/)
    expect(() => decodeReport({ notFiles: [] })).toThrow(/files/)
  })

  it('rejects a group missing benchmarks or fullName, and a benchmark with the wrong field types', () => {
    expect(() => decodeReport({ files: [{ filepath: 'a.bench.ts', groups: [{ fullName: 'g' }] }] })).toThrow(
      /benchmarks/,
    )
    expect(() =>
      decodeReport({ files: [{ filepath: 'a.bench.ts', groups: [{ benchmarks: [{ mean: 1, name: 'x' }] }] }] }),
    ).toThrow(/fullName/)
    expect(() =>
      decodeReport({
        files: [
          { filepath: 'a.bench.ts', groups: [{ benchmarks: [{ mean: 'not-a-number', name: 'x' }], fullName: 'g' }] },
        ],
      }),
    ).toThrow(/mean/)
    expect(() =>
      decodeReport({
        files: [{ filepath: 'a.bench.ts', groups: [{ benchmarks: [{ mean: 1, name: 42 }], fullName: 'g' }] }],
      }),
    ).toThrow(/name/)
  })
})

describe('appending the synthetic bench entry to a report', () => {
  it('appends without mutating the original report', () => {
    const original = { files: [{ filepath: 'existing.bench.ts', groups: [] }] }
    const updated = appendSyntheticBenchEntry(original, {
      filepath: 'dist/cli.js (synthetic)',
      fullName: 'cli-check',
      mean: 42,
      name: 'check, 40 docs (10-run mean)',
    })
    expect(original.files).toHaveLength(1)
    expect(updated.files).toHaveLength(2)
    expect(updated.files[1]).toEqual({
      filepath: 'dist/cli.js (synthetic)',
      groups: [{ benchmarks: [{ mean: 42, name: 'check, 40 docs (10-run mean)' }], fullName: 'cli-check' }],
    })
  })
})
