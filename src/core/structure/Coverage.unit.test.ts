import { describe, expect, it } from 'vitest'

import type { DocMetadata } from './DocMetadata.ts'
import { collectExternalRefTargets, resolveRuleEdges } from './Coverage.ts'

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

  // Issue #28's third v1 check, doc→code reference resolution: a rule whose
  // `to` is `{ external: 'path' }` is satisfied by a link resolving to a
  // real FILE, never a scanned/kind-classified doc — `externalExists` is
  // the caller's pre-computed IO result (this function stays pure/IO-free),
  // exactly the same shape a real filesystem existence check would confirm.
  describe('to: { external: "path" } — doc→code reference resolution', () => {
    it('is satisfied when the ref resolves to a path in `externalExists`', () => {
      const docs = [doc('/r/specs/s1.md', ['spec'], [ref('../../src/foo.ts')])]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        externalExists: new Set(['/src/foo.ts']),
        rules: [{ from: 'spec', to: { external: 'path' } }],
      })
      expect(edges).toEqual([
        {
          doc: '/r/specs/s1.md',
          rule: { from: 'spec', to: { external: 'path' } },
          satisfiedBy: [{ node: ref('../../src/foo.ts'), targetPath: '/src/foo.ts' }],
        },
      ])
    })

    it('is unsatisfied when the ref target is absent from `externalExists`', () => {
      const docs = [doc('/r/specs/s1.md', ['spec'], [ref('../../src/missing.ts')])]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        externalExists: new Set(['/src/foo.ts']),
        rules: [{ from: 'spec', to: { external: 'path' } }],
      })
      expect(edges).toEqual([
        { doc: '/r/specs/s1.md', rule: { from: 'spec', to: { external: 'path' } }, satisfiedBy: [] },
      ])
    })

    it('is unsatisfied when `externalExists` is omitted entirely — never silently satisfied by default', () => {
      const docs = [doc('/r/specs/s1.md', ['spec'], [ref('../../src/foo.ts')])]
      const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'spec', to: { external: 'path' } }] })
      expect(edges).toEqual([
        { doc: '/r/specs/s1.md', rule: { from: 'spec', to: { external: 'path' } }, satisfiedBy: [] },
      ])
    })

    // A ref that happens to resolve to a scanned, kind-classified doc still
    // satisfies an external-path rule — the rule only asks "does this path
    // exist," never "is it NOT a doc."
    it('is satisfied by a ref that resolves to a scanned doc, as long as its path is in `externalExists`', () => {
      const docs = [
        doc('/r/specs/s1.md', ['spec'], [ref('../decisions/d1.md')]),
        doc('/r/decisions/d1.md', ['decision']),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        externalExists: new Set(['/r/decisions/d1.md']),
        rules: [{ from: 'spec', to: { external: 'path' } }],
      })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })
  })

  // Real capturability finding (docs/design/CONVENTION.md): a wildcard `to`-
  // kind glob matching many instances (e.g. every design package's own
  // spikes.md) lets doc A's rule be satisfied by doc B's sibling — verified
  // concretely with a real throwaway package before this field existed.
  describe('scope: "sibling"', () => {
    it('is NOT satisfied by a to-kind doc in a DIFFERENT directory — the exact capturability gap this closes', () => {
      const docs = [
        doc('/r/design/pkg-a/roadmap.md', ['roadmap'], [ref('../pkg-b/spikes.md')]),
        doc('/r/design/pkg-b/spikes.md', ['spikes']),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', scope: 'sibling', to: 'spikes' }],
      })
      expect(edges[0]?.satisfiedBy).toEqual([])
    })

    it('IS satisfied by a to-kind doc in the SAME directory', () => {
      const docs = [
        doc('/r/design/pkg-a/roadmap.md', ['roadmap'], [ref('./spikes.md')]),
        doc('/r/design/pkg-a/spikes.md', ['spikes']),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', scope: 'sibling', to: 'spikes' }],
      })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })

    it('without `scope`, the SAME cross-directory link DOES satisfy — proves scope is opt-in, not a silent behavior change', () => {
      const docs = [
        doc('/r/design/pkg-a/roadmap.md', ['roadmap'], [ref('../pkg-b/spikes.md')]),
        doc('/r/design/pkg-b/spikes.md', ['spikes']),
      ]
      const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'roadmap', to: 'spikes' }] })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })

    it('is a deliberate no-op for an `{ external: "path" }` target — nothing to scope by', () => {
      const docs = [doc('/r/design/pkg-a/roadmap.md', ['roadmap'], [ref('../../src/foo.ts')])]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        externalExists: new Set(['/r/src/foo.ts']),
        rules: [{ from: 'roadmap', scope: 'sibling', to: { external: 'path' } }],
      })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })
  })
})

describe('collectExternalRefTargets()', () => {
  it('collects the resolved target path of every ref under a from-kind doc whose rule has an external `to`', () => {
    const docs = [doc('/r/specs/s1.md', ['spec'], [ref('../../src/foo.ts'), ref('../../src/bar.ts', 2)])]
    const targets = collectExternalRefTargets(docs, [], [{ from: 'spec', to: { external: 'path' } }])
    expect([...targets].toSorted()).toEqual(['/src/bar.ts', '/src/foo.ts'])
  })

  it('never collects a ref under a doc whose kind has no external-typed rule', () => {
    const docs = [doc('/r/specs/s1.md', ['spec'], [ref('../../src/foo.ts')])]
    const targets = collectExternalRefTargets(docs, [], [{ from: 'spec', to: 'decision' }])
    expect(targets).toEqual([])
  })

  // Distinct from "no external-typed rule at all" above: here an
  // external-typed rule DOES exist, just not for THIS doc's own kind —
  // exercises the per-doc kind-match skip, not the whole-function early
  // return short-circuit.
  it('never collects a ref under a doc whose OWN kind has no external-typed rule, even when a DIFFERENT kind does', () => {
    const docs = [doc('/r/notes/n1.md', ['note'], [ref('../../src/foo.ts')])]
    const targets = collectExternalRefTargets(docs, [], [{ from: 'spec', to: { external: 'path' } }])
    expect(targets).toEqual([])
  })

  it('never collects a ref under a doc matching `exempt`', () => {
    const docs = [doc('/r/specs/templates/blank.md', ['spec'], [ref('../../../src/foo.ts')])]
    const targets = collectExternalRefTargets(
      docs,
      ['/r/specs/templates/**'],
      [{ from: 'spec', to: { external: 'path' } }],
    )
    expect(targets).toEqual([])
  })
})
