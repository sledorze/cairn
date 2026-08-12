import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe } from 'vitest'

import { makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkStoryMapTiers, formatStoryMapTiersReport, storyMapTiersExitCode } from './CheckStoryMapTiers.ts'

const GOOD_DOC = `# Story map

## Cards, by backbone step

### 1. Step one

- _Card A_ (Must)
- _Card B_ (Should)
`

const BAD_DOC = `# Story map

## Cards, by backbone step

### 1. Step one

- _Card A_
- _Card B_

### 2. Step two

- _Card C_ (Must)
- _Card D_ (Must)
`

it.layer(makeTestDocsFs({ '/r/docs/design/a/story-map.md': { content: GOOD_DOC, mtimeMs: 1 } }))(
  'checkStoryMapTiers() — every backbone step has exactly one (Must) card',
  (layerIt) => {
    layerIt.effect('reports no violations', () =>
      Effect.gen(function* () {
        const result = yield* checkStoryMapTiers({ base: '/r', globs: ['docs/design/*/story-map.md'], roots: ['/r'] })
        expect(result.checked).toBe(1)
        expect(result.docViolations).toEqual([])
        expect(storyMapTiersExitCode(result)).toBe(0)
      }),
    )
  },
)

it.layer(makeTestDocsFs({ '/r/docs/design/a/story-map.md': { content: BAD_DOC, mtimeMs: 1 } }))(
  'checkStoryMapTiers() — a doc with a 0-Must step and a 2-Must step',
  (layerIt) => {
    layerIt.effect('reports both violations for that doc', () =>
      Effect.gen(function* () {
        const result = yield* checkStoryMapTiers({ base: '/r', globs: ['docs/design/*/story-map.md'], roots: ['/r'] })
        expect(result.checked).toBe(1)
        expect(result.docViolations).toHaveLength(1)
        expect(result.docViolations[0]?.path).toBe('/r/docs/design/a/story-map.md')
        expect(result.docViolations[0]?.violations).toEqual([
          { heading: '1. Step one', line: 5, mustCount: 0, step: 1 },
          { heading: '2. Step two', line: 10, mustCount: 2, step: 2 },
        ])
        expect(storyMapTiersExitCode(result)).toBe(1)
      }),
    )
  },
)

it.layer(makeTestDocsFs({ '/r/docs/other.md': { content: GOOD_DOC, mtimeMs: 1 } }))(
  'checkStoryMapTiers() — a doc not matching any configured glob',
  (layerIt) => {
    layerIt.effect('is skipped entirely, not counted', () =>
      Effect.gen(function* () {
        const result = yield* checkStoryMapTiers({ base: '/r', globs: ['docs/design/*/story-map.md'], roots: ['/r'] })
        expect(result.checked).toBe(0)
        expect(result.docViolations).toEqual([])
      }),
    )
  },
)

const twoDocsLayer = makeTestDocsFs({
  '/r/docs/design/a/story-map.md': { content: BAD_DOC, mtimeMs: 1 },
  '/r/docs/design/b/story-map.md': { content: BAD_DOC, mtimeMs: 1 },
})

it.layer(twoDocsLayer)('checkStoryMapTiers() — trackedFiles narrowing the scanned universe', (layerIt) => {
  layerIt.effect('only counts the tracked doc, not every doc on disk', () =>
    Effect.gen(function* () {
      const result = yield* checkStoryMapTiers({
        base: '/r',
        globs: ['docs/design/*/story-map.md'],
        roots: ['/r'],
        trackedFiles: new Set(['/r/docs/design/a/story-map.md']),
      })
      expect(result.checked).toBe(1)
    }),
  )
})

describe('formatStoryMapTiersReport()', () => {
  it('reports OK with the checked count when nothing violates the invariant', () => {
    const lines = formatStoryMapTiersReport({ checked: 3, docViolations: [] })
    expect(lines.join('\n')).toContain('✅')
    expect(lines.join('\n')).toContain('3')
  })

  it('lists each violating step with its path, line, and Must count', () => {
    const lines = formatStoryMapTiersReport({
      checked: 1,
      docViolations: [
        {
          path: '/r/docs/design/a/story-map.md',
          violations: [{ heading: '1. Step one', line: 5, mustCount: 0, step: 1 }],
        },
      ],
    })
    const joined = lines.join('\n')
    expect(joined).toContain('/r/docs/design/a/story-map.md')
    expect(joined).toContain('5')
    expect(joined).toContain('step 1')
    expect(joined).toContain('0 (Must)')
  })
})
