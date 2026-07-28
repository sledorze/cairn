import { Effect } from 'effect'
import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { formatProseRefsReport, proseRefsPlugin } from './CheckProseRefs.ts'

const CLI: CheckCliFlags = {
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

describe('proseRefsPlugin.isEnabled()', () => {
  it('is disabled by default — prose-refs is CLI-flag opt-in only', () => {
    expect(proseRefsPlugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeFalsy()
  })

  it('is enabled exactly when --prose-refs is set', () => {
    expect(proseRefsPlugin.isEnabled(DEFAULT_CONFIG, { ...CLI, prose: true })).toBeTruthy()
  })
})

test('proseRefsPlugin.jsonUnsupportedMessage matches cli.ts’s exact prior message', () => {
  expect(proseRefsPlugin.jsonUnsupportedMessage).toBe('--json cannot be combined with --prose-refs yet')
})

test('proseRefsPlugin.name is "proseRefs"', () => {
  expect(proseRefsPlugin.name).toBe('proseRefs')
})

test('proseRefsPlugin.format() delegates to formatProseRefsReport()', () => {
  const result = { broken: [], checked: 1 }
  expect(proseRefsPlugin.format(result, { locale: 'en' })).toEqual(formatProseRefsReport(result, { locale: 'en' }))
})

test('proseRefsPlugin has no stamp capability', () => {
  expect(proseRefsPlugin.stamp).toBeUndefined()
})

describe('proseRefsPlugin.run()', () => {
  it('reaches checkProseRefs with roots/ignore wired through, no trackedFiles', async () => {
    const layer = makeTestDocsFs({ '/r/a.md': { content: 'see `nope.ts` for it', mtimeMs: 1 } })
    const result = await Effect.runPromise(
      proseRefsPlugin
        .run({ base: '/r', cli: CLI, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] })
        .pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
  })

  it('reaches checkProseRefs with trackedFiles narrowing the scanned universe', async () => {
    const layer = makeTestDocsFs({
      '/r/a.md': { content: '# A', mtimeMs: 1 },
      '/r/untracked.md': { content: 'see `nope.ts` for it', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      proseRefsPlugin
        .run({
          base: '/r',
          cli: CLI,
          ignore: [],
          resolved: DEFAULT_CONFIG,
          roots: ['/r'],
          trackedFiles: new Set(['/r/a.md']),
        })
        .pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
  })
})
