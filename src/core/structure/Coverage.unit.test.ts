import { describe, expect, it } from 'vitest'

import type { DocMetadata } from './DocMetadata.ts'
import { resolveRuleEdges } from './Coverage.ts'

const doc = (path: string, kinds: readonly string[], nodes: DocMetadata['nodes'] = []): DocMetadata => ({
  kinds,
  nodes,
  path,
})

const ref = (target: string, line = 1): DocMetadata['nodes'][number] => ({ anchor: null, line, tag: 'ref', target })

describe('resolveRuleEdges()', () => {
  it('returns a satisfied edge when a from-kind doc links to a to-kind doc', () => {
    const docs = [
      doc('/r/features/f1.md', ['feature'], [ref('../decisions/d1.md')]),
      doc('/r/decisions/d1.md', ['decision']),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'feature', to: 'decision' }] })
    expect(edges).toEqual([
      {
        doc: '/r/features/f1.md',
        rule: { from: 'feature', to: 'decision' },
        satisfiedBy: [{ node: ref('../decisions/d1.md'), targetPath: '/r/decisions/d1.md' }],
      },
    ])
  })

  it('returns an edge with an empty satisfiedBy when the rule is not satisfied at all', () => {
    const docs = [doc('/r/features/f1.md', ['feature'], []), doc('/r/decisions/d1.md', ['decision'])]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'feature', to: 'decision' }] })
    expect(edges).toEqual([{ doc: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' }, satisfiedBy: [] }])
  })

  it('produces no edge at all for a doc that does not match the rule’s `from` kind', () => {
    const docs = [doc('/r/notes/n1.md', ['note'], []), doc('/r/decisions/d1.md', ['decision'])]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'feature', to: 'decision' }] })
    expect(edges).toEqual([])
  })

  it('a link to a doc that does not resolve to the required `to` kind does not satisfy — reported as unsatisfied, not simply absent', () => {
    const docs = [doc('/r/features/f1.md', ['feature'], [ref('../notes/other.md')]), doc('/r/notes/other.md', ['note'])]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'feature', to: 'decision' }] })
    expect(edges).toEqual([{ doc: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' }, satisfiedBy: [] }])
  })

  // Groundwork for a future cardinality (`minCount`) rule variant: every
  // satisfying ref is collected, not just the first — collapsing to a
  // boolean here would silently throw away the count a future consumer needs.
  it('collects EVERY satisfying ref, not just the first, when a doc links to more than one to-kind doc', () => {
    const docs = [
      doc('/r/features/f1.md', ['feature'], [ref('../decisions/d1.md'), ref('../decisions/d2.md', 2)]),
      doc('/r/decisions/d1.md', ['decision']),
      doc('/r/decisions/d2.md', ['decision']),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'feature', to: 'decision' }] })
    expect(edges).toHaveLength(1)
    expect(edges[0]?.satisfiedBy).toHaveLength(2)
    expect(edges[0]?.satisfiedBy.map((s) => s.targetPath).toSorted()).toEqual([
      '/r/decisions/d1.md',
      '/r/decisions/d2.md',
    ])
  })

  it('produces one edge per applicable rule when a doc/kind matches more than one rule', () => {
    const docs = [
      doc('/r/features/f1.md', ['feature'], []),
      doc('/r/decisions/d1.md', ['decision']),
      doc('/r/specs/s1.md', ['spec']),
    ]
    const edges = resolveRuleEdges({
      docs,
      exempt: [],
      rules: [
        { from: 'feature', to: 'decision' },
        { from: 'feature', to: 'spec' },
      ],
    })
    expect(edges).toEqual([
      { doc: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' }, satisfiedBy: [] },
      { doc: '/r/features/f1.md', rule: { from: 'feature', to: 'spec' }, satisfiedBy: [] },
    ])
  })

  // `exempt` excludes a doc from edge resolution ENTIRELY (not just from
  // being reported as missing) — matches the fix that made `exempt` opt a
  // doc out of missing-coverage reporting, so any future consumer of this
  // shared function (e.g. a stale-link check) inherits the same exemption,
  // never a second place that has to remember to apply it.
  it('produces no edge at all for a doc matching `exempt`, even an unsatisfied one', () => {
    const docs = [doc('/r/features/templates/blank.md', ['feature'], []), doc('/r/decisions/d1.md', ['decision'])]
    const edges = resolveRuleEdges({
      docs,
      exempt: ['/r/features/templates/**'],
      rules: [{ from: 'feature', to: 'decision' }],
    })
    expect(edges).toEqual([])
  })

  it('handles a same-kind reference cycle without hanging or misreporting', () => {
    const docs = [
      doc('/r/decisions/d1.md', ['decision'], [ref('./d2.md')]),
      doc('/r/decisions/d2.md', ['decision'], [ref('./d1.md')]),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'decision', to: 'decision' }] })
    expect(edges.every((e) => e.satisfiedBy.length > 0)).toBeTruthy()
  })

  it('does not credit a transitive path for a direct rule', () => {
    const docs = [
      doc('/r/features/f1.md', ['feature'], [ref('../decisions/d1.md')]),
      doc('/r/decisions/d1.md', ['decision'], [ref('../specs/s1.md')]),
      doc('/r/specs/s1.md', ['spec']),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'feature', to: 'spec' }] })
    expect(edges).toEqual([{ doc: '/r/features/f1.md', rule: { from: 'feature', to: 'spec' }, satisfiedBy: [] }])
  })
})
