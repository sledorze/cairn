import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe } from 'vitest'

import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
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

// Two VIOLATING docs, deliberately listed in reverse-of-sorted order (see
// `reverseOrderTwoDocsService` below) — with fewer than 2 real entries to compare,
// `Array.prototype.toSorted`'s own comparator is never actually INVOKED (JS's sort skips
// calling the comparator on a 0- or 1-element input), so a single-violating-doc test can
// never exercise `docViolations.toSorted((a, b) => a.path.localeCompare(b.path))` at all.
// This proves the sort is real, not just present: the result comes back path-ordered even
// though the underlying `listFiles` handed them back in the opposite order.
const reverseOrderTwoDocsService: DocsFsService = {
  deleteFile: () => Effect.succeed(undefined),
  exists: () => Effect.succeed(true),
  listFiles: () => Effect.succeed(['/r/docs/design/b/story-map.md', '/r/docs/design/a/story-map.md']),
  readFile: () => Effect.succeed(BAD_DOC),
  realPath: (abs) => Effect.succeed(abs),
  stat: () => Effect.die('not used in this test'),
  writeFile: () => Effect.succeed(undefined),
}

it.layer(Layer.succeed(DocsFs, reverseOrderTwoDocsService))(
  'checkStoryMapTiers() — two violating docs listed in reverse-of-sorted order',
  (layerIt) => {
    layerIt.effect('sorts docViolations by path, not by listing order', () =>
      Effect.gen(function* () {
        const result = yield* checkStoryMapTiers({
          base: '/r',
          globs: ['docs/design/*/story-map.md'],
          roots: ['/r'],
        })
        expect(result.docViolations.map((d) => d.path)).toEqual([
          '/r/docs/design/a/story-map.md',
          '/r/docs/design/b/story-map.md',
        ])
      }),
    )
  },
)

// Same discipline as every sibling check: a doc that LISTS fine but can't actually be READ
// (permission denied, revoked between listing and reading) must not crash the whole run —
// it's silently skipped, same as `CheckDocCoverage.unit.test.ts`'s own
// "does not crash when a coveredBy doc file lists fine but cannot be read" precedent.
const READABLE_GOOD_PATH = '/r/docs/design/good/story-map.md'
const UNREADABLE_PATH = '/r/docs/design/unreadable/story-map.md'
const unreadableDocService: DocsFsService = {
  deleteFile: () => Effect.succeed(undefined),
  exists: () => Effect.succeed(true),
  listFiles: () => Effect.succeed([READABLE_GOOD_PATH, UNREADABLE_PATH]),
  readFile: (abs) => (abs === UNREADABLE_PATH ? Effect.die(new Error('EACCES')) : Effect.succeed(GOOD_DOC)),
  realPath: (abs) => Effect.succeed(abs),
  stat: () => Effect.die('not used in this test'),
  writeFile: () => Effect.succeed(undefined),
}

it.layer(Layer.succeed(DocsFs, unreadableDocService))(
  'checkStoryMapTiers() — a matched doc that lists fine but cannot be read',
  (layerIt) => {
    layerIt.effect('does not crash, and still censuses the other matched docs', () =>
      Effect.gen(function* () {
        const result = yield* checkStoryMapTiers({
          base: '/r',
          globs: ['docs/design/*/story-map.md'],
          roots: ['/r'],
        })
        // Both docs matched the glob and were LISTED (`checked` counts matches, not
        // successful reads — same convention `docCoverageExitCode`'s own `checked` uses),
        // but only the readable one was actually censused; the unreadable one is silently
        // skipped, not a crash and not a false violation.
        expect(result.checked).toBe(2)
        expect(result.docViolations).toEqual([])
      }),
    )
  },
)

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
