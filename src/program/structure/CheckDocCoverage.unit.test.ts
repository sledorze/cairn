import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkDocCoverage, docCoverageExitCode, formatDocCoverageReport } from './CheckDocCoverage.ts'

const COVERED_BY = [{ glob: 'docs/**', kind: 'architecture' }]
const SOURCES = ['src/**/*.ts']

describe('checkDocCoverage()', () => {
  it('reports nothing when a doc directly links to the source file', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/architecture.md': { content: '# Architecture\n\n[foo](../src/foo.ts)', mtimeMs: 1 },
      '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({ base: '/r', coveredBy: COVERED_BY, sources: SOURCES }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
    expect(result.missing).toEqual([])
    expect(result.unmatchedKinds).toEqual([])
    expect(docCoverageExitCode(result)).toBe(0)
  })

  it('reports a source file with zero inbound links as missing', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/architecture.md': { content: '# Architecture, no links at all', mtimeMs: 1 },
      '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({ base: '/r', coveredBy: COVERED_BY, sources: SOURCES }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual(['/r/src/foo.ts'])
    expect(docCoverageExitCode(result)).toBe(1)
  })

  it('does not report a source file matched by `exempt`', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/architecture.md': { content: '# Architecture, no links at all', mtimeMs: 1 },
      '/r/src/generated.ts': { content: 'export const g = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({
        base: '/r',
        coveredBy: COVERED_BY,
        exempt: ['src/generated.ts'],
        sources: SOURCES,
      }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(0)
    expect(result.missing).toEqual([])
  })

  it('reports a coveredBy kind whose glob matched zero real doc files', async () => {
    const layer = makeTestDocsFs({
      '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({ base: '/r', coveredBy: COVERED_BY, sources: SOURCES }).pipe(Effect.provide(layer)),
    )
    expect(result.unmatchedKinds).toEqual(['architecture'])
  })

  it('does not count a reference through an intermediate doc — non-transitive by construction', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/architecture.md': { content: '# Architecture\n\n[other](./other.md)', mtimeMs: 1 },
      '/r/docs/other.md': { content: '# Other\n\n[foo](../src/foo.ts)', mtimeMs: 1 },
      '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({
        base: '/r',
        coveredBy: [{ glob: 'docs/architecture.md', kind: 'architecture' }],
        sources: SOURCES,
      }).pipe(Effect.provide(layer)),
    )
    // `other.md` isn't in the `architecture` group's own glob, so its link to
    // foo.ts must never count — only architecture.md's OWN direct links do.
    expect(result.missing).toEqual(['/r/src/foo.ts'])
  })

  // Adversarial-review finding: `listFiles`'s own `ignore` only prunes
  // DIRECTORIES (see DocsFs.ts's `isPrunedDir` comment) — a file-shaped
  // `ignore` pattern must be re-checked per file on the `coveredBy` side too
  // (an earlier version of this file only did it for `sources`, letting an
  // ignored/generated doc still count as a legitimate covering doc).
  it('does not count a link from a doc matched by a file-shaped `ignore` pattern', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/generated.md': { content: '# Generated, must be excluded\n\n[foo](../src/foo.ts)', mtimeMs: 1 },
      '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({
        base: '/r',
        coveredBy: COVERED_BY,
        ignore: ['docs/generated.md'],
        sources: SOURCES,
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual(['/r/src/foo.ts'])
  })

  it('never scans a non-.md file as a covering doc, even one matching a coveredBy glob', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/notes.txt': { content: '[foo](../src/foo.ts)', mtimeMs: 1 },
      '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({ base: '/r', coveredBy: COVERED_BY, sources: SOURCES }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual(['/r/src/foo.ts'])
    expect(result.unmatchedKinds).toEqual(['architecture'])
  })

  // Same discipline as every sibling check: a covering doc that LISTS fine
  // but can't actually be READ (permission denied, revoked between listing
  // and reading) must not crash the whole run — it's silently skipped, same
  // as `readMarkdownCorpus`'s own `catchDefect` handling.
  it('does not crash when a coveredBy doc file lists fine but cannot be read', async () => {
    const files: Record<string, string> = { '/r/src/foo.ts': 'export const foo = 1' }
    const service: DocsFsService = {
      deleteFile: () => Effect.succeed(undefined),
      exists: () => Effect.succeed(true),
      listFiles: () => Effect.succeed(['/r/docs/unreadable.md', ...Object.keys(files)]),
      readFile: (abs) =>
        abs === '/r/docs/unreadable.md' ? Effect.die(new Error('EACCES')) : Effect.succeed(files[abs] ?? ''),
      realPath: (abs) => Effect.succeed(abs),
      stat: () => Effect.die('not used in this test'),
      writeFile: () => Effect.succeed(undefined),
    }
    const layer = Layer.succeed(DocsFs, service)
    const result = await Effect.runPromise(
      checkDocCoverage({ base: '/r', coveredBy: COVERED_BY, sources: SOURCES }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual(['/r/src/foo.ts'])
    expect(result.unmatchedKinds).toEqual([])
  })

  it('satisfies coverage from ANY one of multiple coveredBy groups (OR semantics)', async () => {
    const layer = makeTestDocsFs({
      '/r/adr/0001.md': { content: '# ADR\n\n[foo](../src/foo.ts)', mtimeMs: 1 },
      '/r/docs/architecture.md': { content: '# Architecture, no links', mtimeMs: 1 },
      '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkDocCoverage({
        base: '/r',
        coveredBy: [
          { glob: 'docs/**', kind: 'architecture' },
          { glob: 'adr/**', kind: 'adr' },
        ],
        sources: SOURCES,
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([])
  })
})

describe('formatDocCoverageReport()', () => {
  it('reports OK when nothing is missing', () => {
    const lines = formatDocCoverageReport({ checked: 3, missing: [], unmatchedKinds: [] })
    expect(lines.join('\n')).toContain('✅')
  })

  it('lists each missing source path and each unmatched kind', () => {
    const lines = formatDocCoverageReport({
      checked: 1,
      missing: ['/r/src/foo.ts'],
      unmatchedKinds: ['architecture'],
    })
    expect(lines.some((l) => l.includes('/r/src/foo.ts'))).toBeTruthy()
    expect(lines.some((l) => l.includes('architecture'))).toBeTruthy()
  })
})
