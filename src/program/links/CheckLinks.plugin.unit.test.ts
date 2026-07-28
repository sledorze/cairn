import { Effect } from 'effect'
import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { formatLinkReport, linksPlugin } from './CheckLinks.ts'

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

test('linksPlugin.format() delegates to formatLinkReport()', () => {
  const result = { broken: [], checked: 2, fixed: 0, unreadable: [] }
  expect(linksPlugin.format(result, { locale: 'en' })).toEqual(formatLinkReport(result, { locale: 'en' }))
})

// Real end-to-end wiring, both trackedFiles branches: a wiring bug (e.g.
// forgetting to thread `cli.fix` through, or always/never spreading
// `trackedFiles`) would silently misbehave without these.
describe('linksPlugin.run()', () => {
  it('reaches checkLinks with fix/roots/ignore wired through, no trackedFiles', async () => {
    const layer = makeTestDocsFs({ '/r/a.md': { content: '# A\n\n[dead](./nope.md)', mtimeMs: 1 } })
    const result = await Effect.runPromise(
      linksPlugin
        .run({ base: '/r', cli: { ...CLI, fix: false }, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] })
        .pipe(Effect.provide(layer)),
    )
    expect(result.broken).toHaveLength(1)
  })

  it('reaches checkLinks with trackedFiles narrowing the scanned universe', async () => {
    const layer = makeTestDocsFs({
      '/r/a.md': { content: '# A', mtimeMs: 1 },
      '/r/untracked.md': { content: '# Untracked\n\n[dead](./nope.md)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      linksPlugin
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
    expect(result.broken).toEqual([])
  })
})
