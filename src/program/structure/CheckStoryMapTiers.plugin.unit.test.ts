import { expect, it } from '@effect/vitest'
import { Cause, Effect, Exit } from 'effect'
import { describe, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import type { DocsFs } from '../../io/DocsFs.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags, CheckPlugin } from '../checks/CheckPlugin.ts'
import type { StoryMapTiersResult } from './CheckStoryMapTiers.ts'
import { formatStoryMapTiersReport, storyMapTiersPlugin } from './CheckStoryMapTiers.ts'

const CLI: CheckCliFlags = {
  changed: [],
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

// Widened back to the full `CheckPlugin<StoryMapTiersResult, DocsFs>` interface shape
// purely for THIS test file's call sites — `storyMapTiersPlugin` itself is declared with
// `satisfies` (not `:`), so its own inferred type is the narrower object literal, matching
// `freshnessPlugin`'s own precedent (`./CheckFreshness.plugin.unit.test.ts`).
const plugin: CheckPlugin<StoryMapTiersResult, DocsFs> = storyMapTiersPlugin

describe('storyMapTiersPlugin.isEnabled()', () => {
  it('is disabled by default — checks.storyMapTiers defaults to null', () => {
    expect(plugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeFalsy()
  })

  it('is enabled exactly when checks.storyMapTiers is non-null — presence is the opt-in, no CLI flag', () => {
    const resolved = {
      ...DEFAULT_CONFIG,
      checks: { ...DEFAULT_CONFIG.checks, storyMapTiers: { globs: [] } },
    }
    expect(plugin.isEnabled(resolved, CLI)).toBeTruthy()
  })
})

test('storyMapTiersPlugin.jsonUnsupportedMessage matches its own opt-in message', () => {
  expect(storyMapTiersPlugin.jsonUnsupportedMessage).toBe('--json cannot be combined with checks.storyMapTiers yet')
})

test('storyMapTiersPlugin.name is "storyMapTiers"', () => {
  expect(storyMapTiersPlugin.name).toBe('storyMapTiers')
})

test('storyMapTiersPlugin.format() delegates to formatStoryMapTiersReport()', () => {
  const result = { checked: 1, docViolations: [] }
  expect(storyMapTiersPlugin.format(result, { locale: 'en' })).toEqual(
    formatStoryMapTiersReport(result, { locale: 'en' }),
  )
})

test('storyMapTiersPlugin has no stamp capability', () => {
  expect(plugin.stamp).toBeUndefined()
})

it.layer(makeTestDocsFs({}))('storyMapTiersPlugin.run() called with checks.storyMapTiers disabled', (layerIt) => {
  layerIt.effect('dies with a clear, named defect, not a raw destructure TypeError', () =>
    Effect.gen(function* () {
      const exit = yield* storyMapTiersPlugin
        .run({ base: '/r', cli: CLI, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBeTruthy()
      const message = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ''
      expect(message).toMatch(/StoryMapTiersPluginMisuse.*checks\.storyMapTiers.*disabled/i)
    }),
  )
})

const oneDocLayer = makeTestDocsFs({
  '/r/docs/design/a/story-map.md': {
    content: '# S\n\n## Cards, by backbone step\n\n### 1. Step\n\n- _Card_\n',
    mtimeMs: 1,
  },
})

const RESOLVED_WITH_GLOB = {
  ...DEFAULT_CONFIG,
  checks: { ...DEFAULT_CONFIG.checks, storyMapTiers: { globs: ['docs/design/*/story-map.md'] } },
}

it.layer(oneDocLayer)('storyMapTiersPlugin.run() with a configured glob', (layerIt) => {
  layerIt.effect('actually reaches checkStoryMapTiers with the resolved globs', () =>
    Effect.gen(function* () {
      const result = yield* storyMapTiersPlugin.run({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: RESOLVED_WITH_GLOB,
        roots: ['/r'],
      })
      expect(result.checked).toBe(1)
      expect(result.docViolations).toHaveLength(1)
    }),
  )
})

const twoDocsLayer = makeTestDocsFs({
  '/r/docs/design/a/story-map.md': {
    content: '# S\n\n## Cards, by backbone step\n\n### 1. Step\n\n- _Card_ (Must)\n',
    mtimeMs: 1,
  },
  '/r/docs/design/b/story-map.md': {
    content: '# S\n\n## Cards, by backbone step\n\n### 1. Step\n\n- _Card_ (Must)\n',
    mtimeMs: 1,
  },
})

it.layer(twoDocsLayer)('storyMapTiersPlugin.run() with trackedFiles narrowing the scanned universe', (layerIt) => {
  layerIt.effect('only counts the tracked doc, not every doc on disk', () =>
    Effect.gen(function* () {
      const result = yield* storyMapTiersPlugin.run({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: RESOLVED_WITH_GLOB,
        roots: ['/r'],
        trackedFiles: new Set(['/r/docs/design/a/story-map.md']),
      })
      expect(result.checked).toBe(1)
    }),
  )
})
