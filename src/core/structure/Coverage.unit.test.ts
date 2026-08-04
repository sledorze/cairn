import { describe, expect, it } from 'vitest'

import type { DocMetadata } from './DocMetadata.ts'
import { collectExternalRefTargets, resolveRuleEdges } from './Coverage.ts'

const doc = (path: string, kinds: readonly string[], nodes: DocMetadata['nodes'] = []): DocMetadata => ({
  kinds,
  nodes,
  path,
})

const ref = (target: string, line = 1): DocMetadata['nodes'][number] => ({ anchor: null, line, tag: 'ref', target })

const urlRef = (target: string, line = 1): DocMetadata['nodes'][number] => ({ line, tag: 'urlRef', target })

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

  // The gap this closes (docs/design/CONVENTION.md, docs/adr/0005): nothing
  // could require a link to an external URL, only to a scanned doc or a
  // real file on disk. `{ external: 'url', pattern }` is satisfied by a
  // `urlRef` node (a link `isCheckableTarget` excludes, e.g. `https://…` —
  // see ./DocMetadata.ts's own comment) whose raw href CONTAINS `pattern`.
  describe('to: { external: "url", pattern } — a link matching an external URL pattern', () => {
    it('is satisfied when a urlRef node’s href contains the pattern', () => {
      const docs = [
        doc('/r/design/pkg/roadmap.md', ['roadmap'], [urlRef('https://github.com/example/repo/issues/101')]),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } }],
      })
      expect(edges).toEqual([
        {
          doc: '/r/design/pkg/roadmap.md',
          rule: { from: 'roadmap', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } },
          satisfiedBy: [
            {
              node: urlRef('https://github.com/example/repo/issues/101'),
              targetPath: 'https://github.com/example/repo/issues/101',
            },
          ],
        },
      ])
    })

    // FALSIFIED: ran with the doc's only link REMOVED (an empty `nodes`
    // array, matching what a real "drop the issue link" edit would produce)
    // — the edge came back unsatisfied, confirming this isn't a vacuous
    // always-satisfied assertion. Restored `nodes` to include the link
    // above and it's satisfied again.
    it('is unsatisfied when no urlRef node’s href contains the pattern', () => {
      const docs = [doc('/r/design/pkg/roadmap.md', ['roadmap'], [urlRef('https://github.com/other/repo/issues/1')])]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } }],
      })
      expect(edges).toEqual([
        {
          doc: '/r/design/pkg/roadmap.md',
          rule: { from: 'roadmap', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } },
          satisfiedBy: [],
        },
      ])
    })

    // A plain `ref` node (a relative same-repo path) must never satisfy a
    // url-pattern rule, even if its literal text happens to contain the
    // pattern substring — only a `urlRef` node (a link `isCheckableTarget`
    // excluded in the first place) is eligible.
    it('a plain `ref` node never satisfies a url-pattern rule, even on a coincidental substring match', () => {
      const docs = [doc('/r/design/pkg/roadmap.md', ['roadmap'], [ref('./https://github.com/example/repo/issues/')])]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } }],
      })
      expect(edges[0]?.satisfiedBy).toEqual([])
    })

    it('is a deliberate no-op for `scope: "sibling"` — nothing to scope by, same as `{ external: "path" }`', () => {
      const docs = [
        doc('/r/design/pkg-a/roadmap.md', ['roadmap'], [urlRef('https://github.com/example/repo/issues/101')]),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [
          {
            from: 'roadmap',
            scope: 'sibling',
            to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' },
          },
        ],
      })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })
  })

  // A `urlRef` node must never satisfy a plain kind-target rule, even when
  // it sits alongside a real satisfying `ref` node in the same doc — proves
  // the two tags stay genuinely partitioned, not just "usually" separate.
  it('a urlRef node is ignored (never satisfies) a plain kind-target rule, even alongside a satisfying ref node', () => {
    const docs = [
      doc(
        '/r/features/f1.md',
        ['feature'],
        [urlRef('https://github.com/example/repo/issues/1'), ref('../decisions/d1.md', 2)],
      ),
      doc('/r/decisions/d1.md', ['decision']),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'feature', to: 'decision' }] })
    expect(edges[0]?.satisfiedBy).toEqual([{ node: ref('../decisions/d1.md', 2), targetPath: '/r/decisions/d1.md' }])
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

  // Closes the granularity gap between `'sibling'` (exact same directory)
  // and unscoped (anywhere in the corpus) — docs/design/CONVENTION.md's
  // "Judging this convention" Claim 2.
  describe('scope: { under: "..." }', () => {
    it('IS satisfied by a to-kind doc nested ANYWHERE below the given directory, not just directly in it', () => {
      const docs = [
        doc('/r/design/team-b/pkg-a/roadmap.md', ['roadmap'], [ref('../../team-b/pkg-c/nested/spikes.md')]),
        doc('/r/design/team-b/pkg-c/nested/spikes.md', ['spikes']),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', scope: { under: 'design/team-b' }, to: 'spikes' }],
      })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })

    it('is NOT satisfied by a to-kind doc OUTSIDE the given directory', () => {
      const docs = [
        doc('/r/design/team-b/pkg-a/roadmap.md', ['roadmap'], [ref('../../team-a/pkg-x/spikes.md')]),
        doc('/r/design/team-a/pkg-x/spikes.md', ['spikes']),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', scope: { under: 'design/team-b' }, to: 'spikes' }],
      })
      expect(edges[0]?.satisfiedBy).toEqual([])
    })

    it('tolerates a leading/trailing slash on `under` — behaves identically either way', () => {
      const docs = [
        doc('/r/design/team-b/pkg-a/roadmap.md', ['roadmap'], [ref('./spikes.md')]),
        doc('/r/design/team-b/pkg-a/spikes.md', ['spikes']),
      ]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        rules: [{ from: 'roadmap', scope: { under: '/design/team-b/' }, to: 'spikes' }],
      })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })

    it('is a deliberate no-op for an `{ external: "path" }` target — nothing to scope by', () => {
      const docs = [doc('/r/design/team-b/pkg-a/roadmap.md', ['roadmap'], [ref('../../../src/foo.ts')])]
      const edges = resolveRuleEdges({
        docs,
        exempt: [],
        externalExists: new Set(['/r/src/foo.ts']),
        rules: [{ from: 'roadmap', scope: { under: 'design/team-b' }, to: { external: 'path' } }],
      })
      expect(edges[0]?.satisfiedBy).toHaveLength(1)
    })
  })
})

// The gap this closes (docs/design/CONVENTION.md's "Judging this
// convention" Claim 2): `to` accepting an ARRAY of targets, satisfied by a
// link matching ANY ONE of them — alternation/OR, not the AND-only
// semantics multiple separate rules on the same `from` already had.
describe('to: [...] — alternation/OR over multiple targets', () => {
  it('is satisfied by a link to EITHER of two kind alternatives — first alternative', () => {
    const docs = [
      doc('/r/design/pkg/roadmap.md', ['roadmap'], [ref('./spikes.md')]),
      doc('/r/design/pkg/spikes.md', ['spikes']),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'roadmap', to: ['spikes', 'evidence'] }] })
    expect(edges[0]?.satisfiedBy).toHaveLength(1)
  })

  it('is satisfied by a link to EITHER of two kind alternatives — second alternative', () => {
    const docs = [
      doc('/r/design/pkg/roadmap.md', ['roadmap'], [ref('./evidence.md')]),
      doc('/r/design/pkg/evidence.md', ['evidence']),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'roadmap', to: ['spikes', 'evidence'] }] })
    expect(edges[0]?.satisfiedBy).toHaveLength(1)
  })

  // FALSIFIED: the same doc with NEITHER alternative linked is unsatisfied
  // — confirms this isn't a vacuous always-satisfied alternation.
  it('is unsatisfied when the doc links to neither alternative', () => {
    const docs = [
      doc('/r/design/pkg/roadmap.md', ['roadmap'], [ref('./unrelated.md')]),
      doc('/r/design/pkg/spikes.md', ['spikes']),
      doc('/r/design/pkg/evidence.md', ['evidence']),
      doc('/r/design/pkg/unrelated.md', ['other']),
    ]
    const edges = resolveRuleEdges({ docs, exempt: [], rules: [{ from: 'roadmap', to: ['spikes', 'evidence'] }] })
    expect(edges[0]?.satisfiedBy).toEqual([])
  })

  it('mixes a kind alternative with an `{ external: "url", pattern }` alternative — satisfied via the URL branch', () => {
    const docs = [doc('/r/design/pkg/roadmap.md', ['roadmap'], [urlRef('https://github.com/example/repo/issues/101')])]
    const edges = resolveRuleEdges({
      docs,
      exempt: [],
      rules: [
        { from: 'roadmap', to: ['spikes', { external: 'url', pattern: 'https://github.com/example/repo/issues/' }] },
      ],
    })
    expect(edges[0]?.satisfiedBy).toHaveLength(1)
  })

  // `scope: 'sibling'` still applies PER kind-target alternative — a link to
  // a DIFFERENT directory's kind-matching doc must not satisfy, even though
  // it's one of several alternatives.
  it('still honors `scope: "sibling"` per kind alternative', () => {
    const docs = [
      doc('/r/design/pkg-a/roadmap.md', ['roadmap'], [ref('../pkg-b/spikes.md')]),
      doc('/r/design/pkg-b/spikes.md', ['spikes']),
    ]
    const edges = resolveRuleEdges({
      docs,
      exempt: [],
      rules: [{ from: 'roadmap', scope: 'sibling', to: ['spikes', 'evidence'] }],
    })
    expect(edges[0]?.satisfiedBy).toEqual([])
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

  // `{ external: 'url', pattern }` needs no filesystem-existence candidate
  // at all — it's resolved entirely by `resolveRuleEdges` matching a
  // `urlRef` node directly, no IO. A `from` kind used ONLY by a url rule
  // must not pull its OTHER (unrelated) refs into the candidate set.
  it('never collects a ref for a `from` kind used only by an `{ external: "url" }` rule', () => {
    const docs = [doc('/r/design/pkg/roadmap.md', ['roadmap'], [ref('../../src/foo.ts')])]
    const targets = collectExternalRefTargets(
      docs,
      [],
      [{ from: 'roadmap', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } }],
    )
    expect(targets).toEqual([])
  })

  // `to` may be an array of alternatives — a `from` kind is still an
  // external-candidate source when only ONE of its several alternatives is
  // `{ external: 'path' }`, not just when the sole `to` is.
  it('collects a candidate when a `from` kind’s array `to` includes an `{ external: "path" }` alternative among others', () => {
    const docs = [doc('/r/specs/s1.md', ['spec'], [ref('../src/foo.ts')])]
    const targets = collectExternalRefTargets(docs, [], [{ from: 'spec', to: ['decision', { external: 'path' }] }])
    expect(targets).toEqual(['/r/src/foo.ts'])
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
