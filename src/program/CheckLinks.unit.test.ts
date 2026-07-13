import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeTestDocsFs } from '../io/DocsFs.ts'
import { checkLinks, formatLinkReport, linkExitCode } from './CheckLinks.ts'

describe('formatLinkReport()', () => {
  it('reports success with the checked count (English by default)', () => {
    expect(formatLinkReport({ broken: [], checked: 7, fixed: 0 })).toEqual([
      '✅ Markdown links OK (7 file(s) checked).',
    ])
  })

  it('localises to French when asked', () => {
    expect(formatLinkReport({ broken: [], checked: 7, fixed: 0 }, { locale: 'fr' })).toEqual([
      '✅ Liens Markdown OK (7 fichier(s) vérifié(s)).',
    ])
  })

  it('lists broken links with suggestions and a fix note', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ suggestion: '../b/x.md', target: './x.md', text: 't' }] }],
      checked: 3,
      fixed: 1,
    })
    expect(lines[0]).toBe('🔧 Auto-repaired 1 link(s).')
    expect(lines).toContain('  a.md')
    expect(lines.at(-1)).toBe('    ✗ [t](./x.md) → suggestion: ../b/x.md')
  })
})

const seed = (): Record<string, { content: string; mtimeMs: number }> => ({
  '/r/docs/a/exists.md': { content: '# x', mtimeMs: 1 },
  '/r/docs/a/index.md': {
    content: '[ok](./exists.md) [fixme](./moved.md) [ghost](./nope.md)',
    mtimeMs: 1,
  },
  '/r/docs/b/moved.md': { content: '# moved', mtimeMs: 1 },
})

describe('checkLinks()', () => {
  it('reports broken links with suggestions and does not write when fix is off', async () => {
    const layer = makeTestDocsFs(seed())
    const result = await Effect.runPromise(checkLinks({ fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)))

    expect(result.fixed).toBe(0)
    expect(result.broken).toHaveLength(1)
    expect(result.broken[0]?.file).toBe('/r/docs/a/index.md')
    expect(result.broken[0]?.links.map((l) => l.target)).toEqual(['./moved.md', './nope.md'])
    const fixme = result.broken[0]?.links.find((l) => l.target === './moved.md')
    expect(fixme?.suggestion).toBe('../b/moved.md')
    expect(linkExitCode(result)).toBe(1)
  })

  it('auto-repairs unambiguous links and persists the change', async () => {
    const layer = makeTestDocsFs(seed())
    const first = await Effect.runPromise(checkLinks({ fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)))

    expect(first.fixed).toBe(1)
    expect(first.broken[0]?.links.map((l) => l.target)).toEqual(['./nope.md'])

    // Re-running against the same (mutated) layer proves the fix was written.
    const second = await Effect.runPromise(checkLinks({ fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(second.broken[0]?.links.map((l) => l.target)).toEqual(['./nope.md'])
  })

  it('auto-repairs a reference-style link definition', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': { content: 'see [x][d]\n\n[d]: ./moved.md', mtimeMs: 1 },
      '/r/docs/b/moved.md': { content: '# moved', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(checkLinks({ fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.fixed).toBe(1)
    expect(result.broken).toEqual([])
    const after = await Effect.runPromise(checkLinks({ fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(after.broken).toEqual([])
  })

  it('does NOT auto-fix when the same target also appears inside a code example', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': {
        content: 'broken [x](./moved.md)\n\n```md\n[demo](./moved.md)\n```',
        mtimeMs: 1,
      },
      '/r/docs/b/moved.md': { content: '# moved', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(checkLinks({ fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    // The real link is broken and fixable, but fixing would corrupt the code
    // block, so it is reported instead of rewritten.
    expect(result.fixed).toBe(0)
    expect(result.broken[0]?.links.map((l) => l.target)).toEqual(['./moved.md'])
  })

  it('skips ignored source files', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/keep.md': { content: '[dead](./nope.md)', mtimeMs: 1 },
      '/r/docs/vendor/CHANGELOG.md': { content: '[dead](./also-nope.md)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkLinks({ fix: false, ignore: ['**/vendor/**'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken.map((b) => b.file)).toEqual(['/r/docs/keep.md'])
  })
})
