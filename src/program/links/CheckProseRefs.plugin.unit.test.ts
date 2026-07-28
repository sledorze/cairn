import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { proseRefsPlugin } from './CheckProseRefs.ts'

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

test('proseRefsPlugin has no stamp capability', () => {
  expect(proseRefsPlugin.stamp).toBeUndefined()
})
