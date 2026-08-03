import { Effect } from 'effect'
import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { docCoveragePlugin, formatDocCoverageReport } from './CheckDocCoverage.ts'

const CLI: CheckCliFlags = {
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

describe('docCoveragePlugin.isEnabled()', () => {
  it('is disabled by default — checks.docCoverage defaults to null', () => {
    expect(docCoveragePlugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeFalsy()
  })

  it('is enabled exactly when checks.docCoverage is non-null — presence is the opt-in, no CLI flag', () => {
    const resolved = {
      ...DEFAULT_CONFIG,
      checks: { ...DEFAULT_CONFIG.checks, docCoverage: { coveredBy: [], exempt: [], sources: [] } },
    }
    expect(docCoveragePlugin.isEnabled(resolved, CLI)).toBeTruthy()
  })
})

test('docCoveragePlugin.jsonUnsupportedMessage matches its own opt-in message', () => {
  expect(docCoveragePlugin.jsonUnsupportedMessage).toBe('--json cannot be combined with checks.docCoverage yet')
})

test('docCoveragePlugin.name is "docCoverage"', () => {
  expect(docCoveragePlugin.name).toBe('docCoverage')
})

test('run() fails with a clear, named error (not a raw destructure TypeError) when called with checks.docCoverage disabled', async () => {
  const layer = makeTestDocsFs({})
  const effect = docCoveragePlugin
    .run({ base: '/r', cli: CLI, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] })
    .pipe(Effect.provide(layer))
  await expect(Effect.runPromise(effect)).rejects.toThrow(/docCoveragePlugin\.run.*checks\.docCoverage.*disabled/i)
})

test('docCoveragePlugin.format() delegates to formatDocCoverageReport()', () => {
  const result = { checked: 1, missing: [], unmatchedKinds: [] }
  expect(docCoveragePlugin.format(result, { locale: 'en' })).toEqual(formatDocCoverageReport(result, { locale: 'en' }))
})

test('docCoveragePlugin has no stamp capability', () => {
  expect(docCoveragePlugin.stamp).toBeUndefined()
})

test('docCoveragePlugin.run() actually reaches checkDocCoverage with the resolved coveredBy/sources/exempt', async () => {
  const layer = makeTestDocsFs({
    '/r/docs/architecture.md': { content: '# Architecture, no links', mtimeMs: 1 },
    '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
  })
  const resolved = {
    ...DEFAULT_CONFIG,
    checks: {
      ...DEFAULT_CONFIG.checks,
      docCoverage: {
        coveredBy: [{ glob: 'docs/**', kind: 'architecture' }],
        exempt: [],
        sources: ['src/**/*.ts'],
      },
    },
  }
  const result = await Effect.runPromise(
    docCoveragePlugin.run({ base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'] }).pipe(Effect.provide(layer)),
  )
  expect(result.missing).toEqual(['/r/src/foo.ts'])
})

test('docCoveragePlugin.run() also reaches checkDocCoverage with trackedFiles narrowing the scanned universe', async () => {
  const layer = makeTestDocsFs({
    '/r/docs/architecture.md': { content: '# Architecture, no links', mtimeMs: 1 },
    '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    // A SECOND source file, deliberately left OUT of `trackedFiles` — proves
    // the ternary at the trackedFiles call site actually threads through and
    // excludes it, rather than always scanning everything.
    '/r/src/untracked.ts': { content: 'export const u = 1', mtimeMs: 1 },
  })
  const resolved = {
    ...DEFAULT_CONFIG,
    checks: {
      ...DEFAULT_CONFIG.checks,
      docCoverage: {
        coveredBy: [{ glob: 'docs/**', kind: 'architecture' }],
        exempt: [],
        sources: ['src/**/*.ts'],
      },
    },
  }
  const result = await Effect.runPromise(
    docCoveragePlugin
      .run({ base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'], trackedFiles: new Set(['/r/src/foo.ts']) })
      .pipe(Effect.provide(layer)),
  )
  expect(result.checked).toBe(1)
})
