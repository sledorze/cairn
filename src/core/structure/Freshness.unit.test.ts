import { describe, expect, it } from 'vitest'

import { findStaleDocs } from './Freshness.ts'

const DAY_MS = 86_400_000

describe('findStaleDocs()', () => {
  it('reports a doc whose age in whole days exceeds its own maxAgeDays', () => {
    const now = new Date('2024-06-01T00:00:00.000Z')
    const result = findStaleDocs(
      [{ lastCommitDate: new Date('2024-01-01T00:00:00.000Z'), maxAgeDays: 30, path: '/r/docs/a.md' }],
      now,
    )
    expect(result).toEqual([{ ageDays: 152, maxAgeDays: 30, path: '/r/docs/a.md' }])
  })

  it('does not report a doc whose age is under its own maxAgeDays', () => {
    const now = new Date('2024-01-10T00:00:00.000Z')
    const result = findStaleDocs(
      [{ lastCommitDate: new Date('2024-01-01T00:00:00.000Z'), maxAgeDays: 30, path: '/r/docs/a.md' }],
      now,
    )
    expect(result).toEqual([])
  })

  it('does not report a doc exactly at its maxAgeDays boundary (strictly greater-than, not >=)', () => {
    const now = new Date(new Date('2024-01-01T00:00:00.000Z').getTime() + 30 * DAY_MS)
    const result = findStaleDocs(
      [{ lastCommitDate: new Date('2024-01-01T00:00:00.000Z'), maxAgeDays: 30, path: '/r/docs/a.md' }],
      now,
    )
    expect(result).toEqual([])
  })

  it('silently excludes a candidate with no commit history (lastCommitDate === null)', () => {
    const now = new Date('2024-06-01T00:00:00.000Z')
    const result = findStaleDocs([{ lastCommitDate: null, maxAgeDays: 1, path: '/r/docs/new.md' }], now)
    expect(result).toEqual([])
  })

  it('sorts results by path for a deterministic report', () => {
    const now = new Date('2024-06-01T00:00:00.000Z')
    const old = new Date('2020-01-01T00:00:00.000Z')
    const result = findStaleDocs(
      [
        { lastCommitDate: old, maxAgeDays: 1, path: '/r/docs/z.md' },
        { lastCommitDate: old, maxAgeDays: 1, path: '/r/docs/a.md' },
      ],
      now,
    )
    expect(result.map((d) => d.path)).toEqual(['/r/docs/a.md', '/r/docs/z.md'])
  })
})
