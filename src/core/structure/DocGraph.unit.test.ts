import { describe, expect, it } from 'vitest'

import { buildDocGraph } from './DocGraph.ts'
import type { DocMetadata } from './DocMetadata.ts'

const doc = (path: string, refs: readonly { anchor?: string | null; target: string }[]): DocMetadata => ({
  kinds: [],
  nodes: refs.map((r, i) => ({ anchor: r.anchor ?? null, line: i + 1, tag: 'ref' as const, target: r.target })),
  path,
})

describe('buildDocGraph()', () => {
  it('resolves a relative ref target against its own doc’s directory into an absolute path', () => {
    const graph = buildDocGraph([doc('/r/docs/a.md', [{ target: '../decisions/x.md' }])])
    expect(graph.inboundByPath.get('/r/decisions/x.md')).toEqual(['/r/docs/a.md'])
  })

  it('lists every doc that references the same target — membership, order never asserted', () => {
    const graph = buildDocGraph([
      doc('/r/docs/a.md', [{ target: './x.md' }]),
      doc('/r/docs/b.md', [{ target: '../docs/x.md' }]),
    ])
    const inbound = graph.inboundByPath.get('/r/docs/x.md') ?? []
    expect(new Set(inbound)).toEqual(new Set(['/r/docs/a.md', '/r/docs/b.md']))
    expect(inbound).toHaveLength(2)
  })

  it('a target with zero inbound refs simply has no entry — never an empty-array placeholder', () => {
    const graph = buildDocGraph([doc('/r/docs/a.md', [{ target: './x.md' }])])
    expect(graph.inboundByPath.has('/r/docs/never-referenced.md')).toBeFalsy()
  })

  it('a doc with zero refs contributes nothing', () => {
    const graph = buildDocGraph([doc('/r/docs/a.md', [])])
    expect(graph.inboundByPath.size).toBe(0)
  })

  it('dedupes two refs from the SAME doc to the SAME target — one doc, one membership, not two', () => {
    const graph = buildDocGraph([doc('/r/docs/a.md', [{ target: './x.md' }, { anchor: 'sec', target: './x.md' }])])
    expect(graph.inboundByPath.get('/r/docs/x.md')).toEqual(['/r/docs/a.md'])
  })
})
