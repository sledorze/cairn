import { describe, expect, it } from 'vitest'

import { hashContent, sourceHashTag } from './DocSummaries.ts'
import { isDirSummary, planSummaries } from './SummaryTree.ts'

const big = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n')
const freshFileSummary = `${sourceHashTag(hashContent(big))}\n\n# résumé`

const tree = (): Map<string, string> =>
  new Map<string, string>([
    ['/r/docs/a.md', big],
    ['/r/docs/a.summary.md', freshFileSummary],
    ['/r/docs/small.md', 'x\ny'],
    ['/r/docs/sub/b.md', big],
  ])

describe('isDirSummary()', () => {
  it('recognises directory summaries', () => {
    expect(isDirSummary('/r/docs/_SUMMARY.md')).toBeTruthy()
    expect(isDirSummary('/r/docs/a.summary.md')).toBeFalsy()
  })
})

describe('planSummaries()', () => {
  const plan = planSummaries({ files: tree(), roots: ['/r/docs'], thresholdLines: 30 })
  const byPath = new Map(plan.nodes.map((n) => [n.path, n]))

  it('marks a correctly stamped file summary as ok', () => {
    expect(byPath.get('/r/docs/a.summary.md')?.status).toBe('ok')
  })

  it('does not require a summary for a short file', () => {
    expect(byPath.has('/r/docs/small.summary.md')).toBeFalsy()
  })

  it('requires a missing file summary for a long doc', () => {
    expect(byPath.get('/r/docs/sub/b.summary.md')?.status).toBe('missing')
  })

  it('aggregates the right inputs into a directory summary (doc summary if big, doc if small, subdir summary)', () => {
    expect(byPath.get('/r/docs/_SUMMARY.md')?.inputs).toEqual([
      '/r/docs/a.summary.md',
      '/r/docs/small.md',
      '/r/docs/sub/_SUMMARY.md',
    ])
  })

  it('orders the todo bottom-up: file summaries first, then directories deepest-first', () => {
    expect(plan.todo.map((n) => n.path)).toEqual([
      '/r/docs/sub/b.summary.md',
      '/r/docs/sub/_SUMMARY.md',
      '/r/docs/_SUMMARY.md',
    ])
  })

  it('flags a directory summary stale when it does not link every direct child', () => {
    const base = new Map<string, string>([
      ['/r/docs/a.md', big],
      ['/r/docs/a.summary.md', freshFileSummary],
    ])
    const expectedHash = planSummaries({ files: base, roots: ['/r/docs'], thresholdLines: 30 }).nodes.find(
      (n) => n.path === '/r/docs/_SUMMARY.md',
    )?.expectedHash
    const stamp = sourceHashTag(expectedHash ?? '')

    const withLink = new Map(base).set('/r/docs/_SUMMARY.md', `${stamp}\n\nVoir [a](./a.md)`)
    const okNode = planSummaries({ files: withLink, roots: ['/r/docs'], thresholdLines: 30 }).nodes.find(
      (n) => n.path === '/r/docs/_SUMMARY.md',
    )
    expect(okNode?.status).toBe('ok')

    const withoutLink = new Map(base).set('/r/docs/_SUMMARY.md', `${stamp}\n\nAucun lien ici`)
    const staleNode = planSummaries({ files: withoutLink, roots: ['/r/docs'], thresholdLines: 30 }).nodes.find(
      (n) => n.path === '/r/docs/_SUMMARY.md',
    )
    expect(staleNode?.status).toBe('stale')
    expect(staleNode?.missingLinks).toEqual(['/r/docs/a.md'])
  })

  it('flags a directory summary stale when an input hash changes', () => {
    const files = tree()
    files.set('/r/docs/sub/_SUMMARY.md', `${sourceHashTag('0'.repeat(64))}\n# r`)
    files.set('/r/docs/sub/b.summary.md', freshFileSummary)
    const p = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 })
    const sub = p.nodes.find((n) => n.path === '/r/docs/sub/_SUMMARY.md')
    expect(sub?.status).toBe('stale')
  })
})
