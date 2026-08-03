import { describe, expect, it } from 'vitest'

import { findDeletedDocContent } from './DeletionReport.ts'

describe('findDeletedDocContent()', () => {
  it('reports a heading from a deleted doc that appears nowhere else in the remaining corpus', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([['/r/docs/old.md', '### Unique Section\n\nSome prose.']]),
      remainingFiles: new Map([['/r/docs/kept.md', '# Kept\n\nUnrelated content.']]),
    })
    expect(findings).toEqual([
      {
        orphanedHeadings: ['### Unique Section'],
        orphanedLinkTargets: [],
        path: '/r/docs/old.md',
      },
    ])
  })

  it('does not report a heading that also appears verbatim in a remaining doc', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([['/r/docs/old.md', '### Shared Section\n\nSome prose.']]),
      remainingFiles: new Map([['/r/docs/kept.md', '# Kept\n\n### Shared Section\n\nStill here.']]),
    })
    expect(findings).toEqual([])
  })

  it('reports a link target from a deleted doc that is linked nowhere else', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([['/r/docs/old.md', 'See [refs](../src/program/links/CheckRefs.ts) for details.']]),
      remainingFiles: new Map([['/r/docs/kept.md', 'Unrelated content, no links here.']]),
    })
    expect(findings).toEqual([
      {
        orphanedHeadings: [],
        orphanedLinkTargets: ['/r/src/program/links/CheckRefs.ts'],
        path: '/r/docs/old.md',
      },
    ])
  })

  it('does not report a link target that is also linked from a remaining doc', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([['/r/docs/old.md', 'See [refs](../src/program/links/CheckRefs.ts) for details.']]),
      remainingFiles: new Map([['/r/docs/kept.md', 'Also see [refs](../src/program/links/CheckRefs.ts) for details.']]),
    })
    expect(findings).toEqual([])
  })

  it('reports nothing when the deleted doc has no headings and no links at all', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([['/r/docs/old.md', 'Just some plain prose, no structure.']]),
      remainingFiles: new Map([['/r/docs/kept.md', '# Kept']]),
    })
    expect(findings).toEqual([])
  })

  it('ignores a bare same-page anchor link (#heading, no path) — never reported as orphaned', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([['/r/docs/old.md', 'See [above](#some-heading) for details.']]),
      remainingFiles: new Map(),
    })
    expect(findings).toEqual([])
  })

  it('ignores a non-checkable link target (e.g. an external URL) — never reported as orphaned', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([['/r/docs/old.md', 'See [external](https://example.com/page) for details.']]),
      remainingFiles: new Map(),
    })
    expect(findings).toEqual([])
  })

  it('reports nothing when there are no deleted docs at all', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map(),
      remainingFiles: new Map([['/r/docs/kept.md', '# Kept']]),
    })
    expect(findings).toEqual([])
  })

  // A deleted doc citing itself twice, or two headings that happen to be
  // identical text within the SAME deleted doc, must not produce duplicate
  // entries in the finding's own arrays.
  it('deduplicates repeated headings/link targets within the same deleted doc', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([
        ['/r/docs/old.md', '### Dup\n\nSee [a](../src/a.ts) and again [a](../src/a.ts).\n\n### Dup\n\nMore.'],
      ]),
      remainingFiles: new Map(),
    })
    expect(findings).toEqual([
      {
        orphanedHeadings: ['### Dup'],
        orphanedLinkTargets: ['/r/src/a.ts'],
        path: '/r/docs/old.md',
      },
    ])
  })

  // Two independently deleted docs in the SAME batch must not count as
  // "still present elsewhere" for each other — a heading/link shared only
  // between two docs both being deleted together is still genuinely lost.
  it('does not treat another DELETED doc as "elsewhere" — two docs deleted together still both get flagged', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([
        ['/r/docs/old-a.md', '### Shared'],
        ['/r/docs/old-b.md', '### Shared'],
      ]),
      remainingFiles: new Map(),
    })
    expect(findings.map((f) => f.path).toSorted()).toEqual(['/r/docs/old-a.md', '/r/docs/old-b.md'])
  })

  it('reports multiple findings sorted by path', () => {
    const findings = findDeletedDocContent({
      deletedDocs: new Map([
        ['/r/docs/z.md', '### Z Heading'],
        ['/r/docs/a.md', '### A Heading'],
      ]),
      remainingFiles: new Map(),
    })
    expect(findings.map((f) => f.path)).toEqual(['/r/docs/a.md', '/r/docs/z.md'])
  })
})
