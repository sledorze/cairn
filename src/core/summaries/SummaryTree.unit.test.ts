import { describe, expect, it } from 'vitest'

import { hashContent } from '../hashing.ts'
import { isDirSummary, planSummaries } from './SummaryTree.ts'

const big = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n')
const freshFileSummary = '# résumé'

const tree = (): Map<string, string> =>
  new Map<string, string>([
    ['/r/docs/a.md', big],
    ['/r/docs/a.summary.md', freshFileSummary],
    ['/r/docs/small.md', 'x\ny'],
    ['/r/docs/sub/b.md', big],
  ])

/** The stamp a freshly-planned tree would carry, so tests can assert "ok"
 * without depending on stampSummaries (that's CheckSummaries's job). */
const stampsFor = (files: ReadonlyMap<string, string>, roots: readonly string[]): Map<string, string> => {
  const plan = planSummaries({ files, roots, thresholdLines: 30 })
  return new Map(plan.nodes.map((n) => [n.path, n.expectedHash]))
}

/** A fully link-complete tree (see SummaryTree.ts's `requiredLinks`: a directory
 * summary must link every direct source doc and every direct sub-directory
 * path, not their summary paths) — `stampsFor` on this reports every node `ok`. */
const freshTree = (): Map<string, string> =>
  new Map<string, string>([
    ['/r/docs/a.md', big],
    ['/r/docs/a.summary.md', freshFileSummary],
    ['/r/docs/small.md', 'x\ny'],
    ['/r/docs/sub/b.md', big],
    ['/r/docs/sub/b.summary.md', '# résumé b'],
    ['/r/docs/sub/_SUMMARY.md', '- [link](./b.md)'],
    ['/r/docs/_SUMMARY.md', '- [link](./a.md)\n- [link](./small.md)\n- [link](./sub)'],
  ])

describe('isDirSummary()', () => {
  it('recognises directory summaries', () => {
    expect(isDirSummary('/r/docs/_SUMMARY.md')).toBeTruthy()
    expect(isDirSummary('/r/docs/a.summary.md')).toBeFalsy()
  })
})

describe('planSummaries()', () => {
  const files = tree()
  const stamps = stampsFor(files, ['/r/docs'])
  const plan = planSummaries({ files, roots: ['/r/docs'], stamps, thresholdLines: 30 })
  const byPath = new Map(plan.nodes.map((n) => [n.path, n]))

  it('marks a correctly stamped file summary as ok (stamp lives in the sidecar map, not in content)', () => {
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
    // sub/b.summary.md is still missing (no stamp), so its ancestors stay stale/missing too.
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
    const baseStamps = stampsFor(base, ['/r/docs'])

    const withLink = new Map(base).set('/r/docs/_SUMMARY.md', 'Voir [a](./a.md)')
    const okNode = planSummaries({
      files: withLink,
      roots: ['/r/docs'],
      stamps: baseStamps,
      thresholdLines: 30,
    }).nodes.find((n) => n.path === '/r/docs/_SUMMARY.md')
    expect(okNode?.status).toBe('ok')

    const withoutLink = new Map(base).set('/r/docs/_SUMMARY.md', 'Aucun lien ici')
    const staleNode = planSummaries({
      files: withoutLink,
      roots: ['/r/docs'],
      stamps: baseStamps,
      thresholdLines: 30,
    }).nodes.find((n) => n.path === '/r/docs/_SUMMARY.md')
    expect(staleNode?.status).toBe('stale')
    expect(staleNode?.missingLinks).toEqual(['/r/docs/a.md'])
  })

  // Issue #103: a parent `_SUMMARY.md` linking to a child DIRECTORY via its
  // own `_SUMMARY.md` (`./sub/_SUMMARY.md`) — the curated index, and the
  // exact artifact the Merkle model hashes for that child — must count as
  // linking the child, same as the bare directory link (`./sub`) already does.
  it("accepts a link to a child directory's own _SUMMARY.md as satisfying link-completeness", () => {
    const base = new Map<string, string>([
      ['/r/docs/sub/b.md', big],
      ['/r/docs/sub/b.summary.md', '# résumé b'],
      ['/r/docs/sub/_SUMMARY.md', '- [link](./b.md)'],
    ])
    const baseStamps = stampsFor(base, ['/r/docs'])

    const withDirSummaryLink = new Map(base).set('/r/docs/_SUMMARY.md', '- [sub/](./sub/_SUMMARY.md)')
    const node = planSummaries({
      files: withDirSummaryLink,
      roots: ['/r/docs'],
      stamps: baseStamps,
      thresholdLines: 30,
    }).nodes.find((n) => n.path === '/r/docs/_SUMMARY.md')

    expect(node?.missingLinks).toEqual([])
    expect(node?.status).toBe('ok')
  })

  it('flags a directory summary stale when an input hash changes', () => {
    const fresh = freshTree()
    const freshStamps = stampsFor(fresh, ['/r/docs'])
    expect(freshStamps.size).toBeGreaterThan(0)
    // Wrong on purpose, to force a mismatch.
    const corrupted = new Map([...freshStamps, ['/r/docs/sub/_SUMMARY.md', '0'.repeat(64)] as const])
    const p = planSummaries({ files: fresh, roots: ['/r/docs'], stamps: corrupted, thresholdLines: 30 })
    const sub = p.nodes.find((n) => n.path === '/r/docs/sub/_SUMMARY.md')
    expect(sub?.status).toBe('stale')
  })

  it('sanity: a fully link-complete, correctly stamped tree reports every node ok', () => {
    const fresh = freshTree()
    const freshStamps = stampsFor(fresh, ['/r/docs'])
    const p = planSummaries({ files: fresh, roots: ['/r/docs'], stamps: freshStamps, thresholdLines: 30 })
    expect(p.todo).toEqual([])
  })

  it('degrades to "everything stale/missing" when no stamps map is supplied (first run, R2)', () => {
    const p = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 })
    expect(p.nodes.find((n) => n.path === '/r/docs/a.summary.md')?.status).toBe('stale')
  })
})

describe('planSummaries() — stamp/source lifecycle (S2, S3, S4)', () => {
  it('S2: editing the source makes its (still-stamped-for-the-old-content) summary stale', () => {
    const files = tree()
    const stamps = stampsFor(files, ['/r/docs'])
    const edited = new Map(files).set('/r/docs/a.md', `${big}\nmore`)
    const plan = planSummaries({ files: edited, roots: ['/r/docs'], stamps, thresholdLines: 30 })
    expect(plan.nodes.find((n) => n.path === '/r/docs/a.summary.md')?.status).toBe('stale')
  })

  it('S3: a sidecar stamp with no corresponding source is reported as an orphan stamp', () => {
    const files = tree()
    const stamps = stampsFor(files, ['/r/docs'])
    // Delete the source (and, as could also happen, its summary file) — the sidecar
    // stamp for it is the only thing "left behind" for planSummaries to see, since
    // stamps are handed in as an already-loaded map, independent of `files`.
    const withoutSource = new Map(files)
    withoutSource.delete('/r/docs/a.md')
    withoutSource.delete('/r/docs/a.summary.md')
    const plan = planSummaries({ files: withoutSource, roots: ['/r/docs'], stamps, thresholdLines: 30 })
    expect(plan.orphanStamps).toContain('/r/docs/a.summary.md')
  })

  it('S3: ignore globs suppress a deleted-source stamp from being reported', () => {
    const files = tree()
    const stamps = stampsFor(files, ['/r/docs'])
    const withoutSource = new Map(files)
    withoutSource.delete('/r/docs/a.md')
    withoutSource.delete('/r/docs/a.summary.md')
    const plan = planSummaries({
      files: withoutSource,
      ignore: ['/r/docs/a.summary.md'],
      roots: ['/r/docs'],
      stamps,
      thresholdLines: 30,
    })
    expect(plan.orphanStamps).not.toContain('/r/docs/a.summary.md')
  })

  // Issue #102: a root-relative pattern with no leading `**/` (the form
  // anyone actually writes, as opposed to the absolute-path pattern used
  // above) must suppress a deleted-source stamp just as reliably —
  // regression coverage exercised through the real planner, not just
  // `isIgnored`'s own unit tests.
  it('S3b: a root-relative ignore pattern with no leading **/ also suppresses a deleted-source stamp (issue #102)', () => {
    const files = tree()
    const stamps = stampsFor(files, ['/r/docs'])
    const withoutSource = new Map(files)
    withoutSource.delete('/r/docs/a.md')
    withoutSource.delete('/r/docs/a.summary.md')
    const plan = planSummaries({
      files: withoutSource,
      ignore: ['a.summary.md'],
      roots: ['/r/docs'],
      stamps,
      thresholdLines: 30,
    })
    expect(plan.orphanStamps).not.toContain('/r/docs/a.summary.md')
  })

  it('S4: reverting a child edit back to identical bytes leaves the parent manifest hash unchanged', () => {
    const fresh = freshTree()
    const stamps = stampsFor(fresh, ['/r/docs'])
    const parentHashBefore = stamps.get('/r/docs/_SUMMARY.md')

    const edited = new Map(fresh).set('/r/docs/small.md', 'x\ny\nz')
    const reverted = new Map(edited).set('/r/docs/small.md', 'x\ny') // back to identical bytes

    const planReverted = planSummaries({ files: reverted, roots: ['/r/docs'], stamps, thresholdLines: 30 })
    const parentNode = planReverted.nodes.find((n) => n.path === '/r/docs/_SUMMARY.md')
    expect(parentNode?.expectedHash).toBe(parentHashBefore)
    expect(parentNode?.status).toBe('ok') // no spurious stale cascade
  })
})

describe('hashContent() sanity (used throughout via stampsFor)', () => {
  it('is available and deterministic', () => {
    expect(hashContent('x')).toBe(hashContent('x'))
  })
})
