import { describe, expect, it } from 'vitest'

import { findUncoveredSources, findUnmatchedKinds } from './DocCoverage.ts'

describe('findUncoveredSources()', () => {
  it('reports a source path with no entry in coverageByPath at all', () => {
    const result = findUncoveredSources({
      coverageByPath: new Map(),
      sourcePaths: ['/r/src/foo/index.ts'],
    })
    expect(result).toEqual(['/r/src/foo/index.ts'])
  })

  it('reports a source path present in coverageByPath but with an empty kind set', () => {
    const result = findUncoveredSources({
      coverageByPath: new Map([['/r/src/foo/index.ts', new Set()]]),
      sourcePaths: ['/r/src/foo/index.ts'],
    })
    expect(result).toEqual(['/r/src/foo/index.ts'])
  })

  it('does not report a source path covered by at least one kind', () => {
    const result = findUncoveredSources({
      coverageByPath: new Map([['/r/src/foo/index.ts', new Set(['architecture'])]]),
      sourcePaths: ['/r/src/foo/index.ts'],
    })
    expect(result).toEqual([])
  })

  it('only reports the specific uncovered paths, not every source path', () => {
    const result = findUncoveredSources({
      coverageByPath: new Map([['/r/src/covered/index.ts', new Set(['architecture'])]]),
      sourcePaths: ['/r/src/covered/index.ts', '/r/src/uncovered/index.ts'],
    })
    expect(result).toEqual(['/r/src/uncovered/index.ts'])
  })
})

describe('findUnmatchedKinds()', () => {
  it('reports a kind whose glob matched zero real doc files', () => {
    const result = findUnmatchedKinds({
      coveredBy: [{ kind: 'architecture' }],
      matchedCounts: new Map(),
    })
    expect(result).toEqual(['architecture'])
  })

  it('does not report a kind that matched at least one real doc file', () => {
    const result = findUnmatchedKinds({
      coveredBy: [{ kind: 'architecture' }],
      matchedCounts: new Map([['architecture', 1]]),
    })
    expect(result).toEqual([])
  })

  it('reports only the specific unmatched kinds among several declared', () => {
    const result = findUnmatchedKinds({
      coveredBy: [{ kind: 'architecture' }, { kind: 'adr' }],
      matchedCounts: new Map([['architecture', 2]]),
    })
    expect(result).toEqual(['adr'])
  })
})
