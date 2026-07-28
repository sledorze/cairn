import { Effect } from 'effect'
import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { refsPlugin } from './CheckRefs.ts'

const CLI: CheckCliFlags = {
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

describe('refsPlugin.isEnabled()', () => {
  it('is disabled by default — refs is CLI-flag opt-in only, no config field', () => {
    expect(refsPlugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeFalsy()
  })

  it('is enabled exactly when --refs is set', () => {
    expect(refsPlugin.isEnabled(DEFAULT_CONFIG, { ...CLI, refs: true })).toBeTruthy()
  })
})

test('refsPlugin.jsonUnsupportedMessage matches cli.ts’s exact prior message', () => {
  expect(refsPlugin.jsonUnsupportedMessage).toBe('--json cannot be combined with --refs yet')
})

test('refsPlugin.name is "refs"', () => {
  expect(refsPlugin.name).toBe('refs')
})

describe('refsPlugin.stamp()', () => {
  // stampRefs only counts a doc when it has at least one RESOLVABLE
  // reference to record (see CheckRefs.ts's own `records.length > 0`
  // guard) — a doc with zero links contributes nothing to `stamped`, so
  // the fixture needs a real link, not just a doc.
  const FIXTURE = {
    '/r/a.md': { content: '# A\n\n[b](./b.md)', mtimeMs: 1 },
    '/r/b.md': { content: '# B', mtimeMs: 1 },
  }

  // Narrows `refsPlugin.stamp` from `((...) => ...) | undefined` without a
  // `!` non-null assertion (forbidden by this repo's lint config) — a plain
  // `if`-throw is the idiom this codebase already uses elsewhere for a
  // "structurally guaranteed, not statically provable" fact.
  const stamp = refsPlugin.stamp
  if (stamp === undefined) {
    throw new Error('expected refsPlugin.stamp to be defined')
  }

  it('returns the exact pre-existing English stamp message, with the real stamped count', async () => {
    const layer = makeTestDocsFs(FIXTURE)
    const lines = await Effect.runPromise(
      stamp({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: DEFAULT_CONFIG,
        roots: ['/r'],
      }).pipe(Effect.provide(layer)),
    )
    expect(lines).toEqual(["🔗 Stamped 1 doc(s)' reference hash(es) (.cairn/** sidecar)."])
  })

  it('formats in French when locale is fr', async () => {
    const layer = makeTestDocsFs(FIXTURE)
    const lines = await Effect.runPromise(
      stamp({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: { ...DEFAULT_CONFIG, locale: 'fr' },
        roots: ['/r'],
      }).pipe(Effect.provide(layer)),
    )
    expect(lines).toEqual(['🔗 1 document(s) tamponné(s) (hachage des références, fichier annexe .cairn/**).'])
  })
})
