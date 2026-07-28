import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { linksPlugin } from './CheckLinks.ts'

const CLI: CheckCliFlags = {
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

// Matches cli.ts's exact existing gate: `config.checks.links &&
// !parsed.summariesOnly` — a real regression here would silently either
// run links when --summaries-only was requested, or skip it when links
// should run by default.
describe('linksPlugin.isEnabled()', () => {
  it('is enabled by default (checks.links defaults to true, --summaries-only not set)', () => {
    expect(linksPlugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeTruthy()
  })

  it('is disabled when checks.links is false', () => {
    expect(
      linksPlugin.isEnabled({ ...DEFAULT_CONFIG, checks: { ...DEFAULT_CONFIG.checks, links: false } }, CLI),
    ).toBeFalsy()
  })

  it('is disabled when --summaries-only is set, even though checks.links is true', () => {
    expect(linksPlugin.isEnabled(DEFAULT_CONFIG, { ...CLI, summariesOnly: true })).toBeFalsy()
  })
})

// Links has no known --json incompatibility today (it's the one check that
// DOES appear in buildJsonReport's output) — a regression that accidentally
// added a jsonUnsupportedMessage here would silently break `--json`'s
// existing, documented shape.
test('linksPlugin declares no jsonUnsupportedMessage — it participates in --json output', () => {
  expect(linksPlugin.jsonUnsupportedMessage).toBeUndefined()
})

test('linksPlugin.name is "links"', () => {
  expect(linksPlugin.name).toBe('links')
})
