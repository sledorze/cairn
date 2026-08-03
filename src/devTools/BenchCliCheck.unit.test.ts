import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { appendSyntheticBenchEntry, decodeReport, resolveAbsoluteCliPath } from './BenchCliCheck.ts'

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
