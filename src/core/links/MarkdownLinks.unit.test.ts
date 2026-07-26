import { describe, expect, it } from 'vitest'

import {
  buildBasenameIndex,
  checkContent,
  extractLinks,
  extractReferences,
  isCheckableTarget,
  stripAnchor,
  stripCode,
  suggestFix,
} from './MarkdownLinks.ts'

describe('stripCode()', () => {
  it('blanks out fenced code blocks but keeps newlines', () => {
    const md = 'before\n```md\n[x](./nope.md)\n```\nafter [ok](./a.md)'
    const stripped = stripCode(md)
    expect(stripped).not.toContain('./nope.md')
    expect(stripped).toContain('[ok](./a.md)')
    expect(stripped.split('\n')).toHaveLength(md.split('\n').length)
  })

  it('blanks out inline code spans', () => {
    expect(stripCode('use `[x](./nope.md)` here')).not.toContain('./nope.md')
  })

  it('leaves ordinary links untouched', () => {
    expect(stripCode('see [home](./a.md)')).toBe('see [home](./a.md)')
  })
})

describe('extractLinks()', () => {
  it('extracts inline links with text and target', () => {
    const md = 'see [home](./a.md) and [other](../b/c.md).'
    expect(extractLinks(md)).toEqual([
      { target: './a.md', text: 'home' },
      { target: '../b/c.md', text: 'other' },
    ])
  })

  it('extracts the target of image links too', () => {
    expect(extractLinks('![alt](./img.png)')).toEqual([{ target: './img.png', text: 'alt' }])
  })

  it('returns an empty array when there are no links', () => {
    expect(extractLinks('plain text, no links')).toEqual([])
  })

  it('handles links whose text contains backticks/code', () => {
    expect(extractLinks('voir [`PROGRESS.md`](./PROGRESS.md)')).toEqual([
      { target: './PROGRESS.md', text: '`PROGRESS.md`' },
    ])
  })
})

describe('isCheckableTarget()', () => {
  it('rejects external and non-path targets', () => {
    expect(isCheckableTarget('https://x.com')).toBeFalsy()
    expect(isCheckableTarget('http://x.com')).toBeFalsy()
    expect(isCheckableTarget('mailto:a@b.c')).toBeFalsy()
    expect(isCheckableTarget('')).toBeFalsy()
    expect(isCheckableTarget('//cdn.example.com/x')).toBeFalsy()
  })

  it('accepts relative paths', () => {
    expect(isCheckableTarget('./a.md')).toBeTruthy()
    expect(isCheckableTarget('../a/b.md')).toBeTruthy()
    expect(isCheckableTarget('sub/dir/')).toBeTruthy()
  })

  it('accepts a bare same-page anchor (issue #39: now checkable, not silently skipped)', () => {
    expect(isCheckableTarget('#section')).toBeTruthy()
  })
})

describe('stripAnchor()', () => {
  it('removes hash anchors and query strings', () => {
    expect(stripAnchor('a.md#sec')).toBe('a.md')
    expect(stripAnchor('a.md?x=1')).toBe('a.md')
    expect(stripAnchor('a.md')).toBe('a.md')
  })

  // CodeQL flagged the prior `/\?.*$/`-based query strip as a polynomial-ReDoS
  // risk on library input; parseTarget now strips via plain indexOf/slice.
  // Construction proof, not an assumption: CodeQL's own repro shape ("many
  // repetitions of '?'") should complete near-instantly, not scale badly.
  it('stays fast on a target with many repeated `?` characters', () => {
    const adversarial = `a.md${'?'.repeat(200_000)}`
    const start = performance.now()
    stripAnchor(adversarial)
    const elapsedMs = performance.now() - start
    expect(elapsedMs).toBeLessThan(1000)
  })
})

describe('buildBasenameIndex()', () => {
  it('maps each basename to the list of absolute paths', () => {
    const idx = buildBasenameIndex(['/r/docs/a/x.md', '/r/docs/b/x.md', '/r/docs/c/y.md'])
    expect(idx.get('x.md')).toEqual(['/r/docs/a/x.md', '/r/docs/b/x.md'])
    expect(idx.get('y.md')).toEqual(['/r/docs/c/y.md'])
  })
})

describe('suggestFix()', () => {
  const index = buildBasenameIndex(['/r/docs/domaine-probleme/pains/matrice-360.md'])

  it('rewrites a broken link when exactly one file matches (no ambiguity)', () => {
    expect(suggestFix({ fromDir: '/r/docs/domaine-solution/roadmap', index, target: '../pains/matrice-360.md' })).toBe(
      '../../domaine-probleme/pains/matrice-360.md',
    )
  })

  it('prefixes ./ for a file located in the same directory', () => {
    const sameDir = buildBasenameIndex(['/r/docs/x/a.md'])
    expect(suggestFix({ fromDir: '/r/docs/x', index: sameDir, target: '../old/a.md' })).toBe('./a.md')
  })

  it('returns null when the basename is ambiguous', () => {
    const ambiguous = buildBasenameIndex(['/r/docs/a/dup.md', '/r/docs/b/dup.md'])
    expect(suggestFix({ fromDir: '/r/docs/z', index: ambiguous, target: './dup.md' })).toBeNull()
  })

  it('returns null when no file matches', () => {
    expect(suggestFix({ fromDir: '/r/docs/z', index, target: './ghost.md' })).toBeNull()
  })
})

describe('checkContent()', () => {
  const present = new Set(['/r/docs/a/exists.md', '/r/docs/a/img.png'])
  const existsAbs = (p: string): boolean => present.has(p)

  it('flags a broken relative link and leaves good ones alone', () => {
    const content = '[ok](./exists.md) [dead](./missing.md) [ext](https://x.com)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken.map((r) => r.target)).toEqual(['./missing.md'])
    expect(result.broken[0]?.reason).toBe('path')
    expect(result.pending).toEqual([])
  })

  it('defers a cross-file anchor to `pending` instead of ignoring it (issue #39: was silently unchecked)', () => {
    const content = '[ok](./exists.md#heading)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([])
    expect(result.pending).toEqual([
      {
        anchor: 'heading',
        fromDir: '/r/docs/a',
        target: './exists.md#heading',
        targetAbs: '/r/docs/a/exists.md',
        text: 'ok',
      },
    ])
  })

  it('resolves a same-page anchor synchronously — no IO, no `pending` entry', () => {
    const content = '# Getting Started\n\nsee [above](#getting-started)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([])
    expect(result.pending).toEqual([])
  })

  it('flags a same-page anchor that has no matching heading', () => {
    const content = '# Real Heading\n\nsee [ghost](#not-a-real-heading)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([
      { detail: 'available anchors: real-heading', reason: 'anchor', target: '#not-a-real-heading', text: 'ghost' },
    ])
    expect(result.pending).toEqual([])
  })

  it('defers an out-of-`roots` target to `pending` instead of assuming it broken (issue #39 scenario E)', () => {
    const inRoots = (p: string): boolean => p.startsWith('/r/docs/')
    const content = '[code](../../src/cli.ts)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md', inRoots })
    expect(result.broken).toEqual([])
    expect(result.pending).toEqual([
      { anchor: null, fromDir: '/r/docs/a', target: '../../src/cli.ts', targetAbs: '/r/src/cli.ts', text: 'code' },
    ])
  })

  it('attaches a suggested fix when provided an index', () => {
    const index = buildBasenameIndex(['/r/docs/b/missing.md'])
    const content = '[dead](./missing.md)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md', index })
    expect(result.broken[0]?.suggestion).toBe('../b/missing.md')
  })

  it('does not flag links that only appear inside code examples', () => {
    const content = [
      'Here is an example:',
      '```md',
      '[demo](./does-not-exist.md)',
      '```',
      'and `[inline](./nope.md)`',
    ].join('\n')
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([])
    expect(result.pending).toEqual([])
  })

  it('flags a broken reference-style link definition, with a suggestion', () => {
    const index = buildBasenameIndex(['/r/docs/b/missing.md'])
    const content = 'See [the doc][d].\n\n[d]: ./missing.md'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md', index })
    expect(result.broken.map((r) => r.target)).toEqual(['./missing.md'])
    expect(result.broken[0]?.suggestion).toBe('../b/missing.md')
  })

  it('accepts a reference definition whose target exists', () => {
    const content = '[ok][e]\n\n[e]: ./exists.md'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([])
    expect(result.pending).toEqual([])
  })

  // Found via dogfooding (renaming a real file docs/architecture.md links to
  // with `[\`glob.ts\`](../src/core/glob.ts)`-style text): a broken link's
  // reported text must be the AUTHORED text, not blanked by stripCode's
  // inline-code masking just because the visible text happens to be
  // backtick-styled — an error report with blank text isn't actionable.
  it('reports the real text of a broken link even when its visible text is backtick-styled', () => {
    const content = '[`glob.ts`](./missing.md)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([{ reason: 'path', target: './missing.md', text: '`glob.ts`' }])
  })

  it('reports the real text of a link deferred to `pending`, backtick-styled or not', () => {
    const content = '[`exists.md`](./exists.md#heading)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.pending).toEqual([
      {
        anchor: 'heading',
        fromDir: '/r/docs/a',
        target: './exists.md#heading',
        targetAbs: '/r/docs/a/exists.md',
        text: '`exists.md`',
      },
    ])
  })

  it('keeps text correctly aligned per-link across several backtick-styled links in one document (position math does not drift)', () => {
    const content = [
      '- [`a.md`](./a-missing.md)',
      '- fine: [`exists.md`](./exists.md)',
      '- also broken: [`c.md`](./c-missing.md)',
    ].join('\n')
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([
      { reason: 'path', target: './a-missing.md', text: '`a.md`' },
      { reason: 'path', target: './c-missing.md', text: '`c.md`' },
    ])
  })

  it('reports the real label of a broken reference-style definition even when backtick-styled', () => {
    const content = 'See [`the doc`][d].\n\n[`the doc`]: ./missing.md'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([{ reason: 'path', target: './missing.md', text: '[`the doc`]' }])
  })
})

describe('extractReferences()', () => {
  it('extracts a plain cross-file reference with no anchor', () => {
    expect(extractReferences('[core](../src/core/engine.ts)')).toEqual([
      { anchor: null, target: '../src/core/engine.ts' },
    ])
  })

  it('extracts a cross-file reference with an anchor', () => {
    expect(extractReferences('[intro](./guide.md#getting-started)')).toEqual([
      { anchor: 'getting-started', target: './guide.md' },
    ])
  })

  it('excludes same-page anchors — not a reference to another file', () => {
    expect(extractReferences('[jump](#local-section)')).toEqual([])
  })

  it('excludes external/non-checkable targets', () => {
    expect(extractReferences('[site](https://example.com) [mail](mailto:a@b.c)')).toEqual([])
  })

  it('excludes links written inside a code example', () => {
    expect(extractReferences('`[fake](../src/x.ts)`')).toEqual([])
  })

  it('dedupes by (target, anchor) — a file linked twice the same way is one reference', () => {
    const content = '[a](../src/x.ts) and again [b](../src/x.ts)'
    expect(extractReferences(content)).toEqual([{ anchor: null, target: '../src/x.ts' }])
  })

  it('treats the same target with different anchors as distinct references', () => {
    const content = '[one](./guide.md#a) [two](./guide.md#b)'
    expect(extractReferences(content)).toEqual([
      { anchor: 'a', target: './guide.md' },
      { anchor: 'b', target: './guide.md' },
    ])
  })

  it('includes reference-style link definitions', () => {
    const content = 'see [x][d]\n\n[d]: ../src/x.ts'
    expect(extractReferences(content)).toEqual([{ anchor: null, target: '../src/x.ts' }])
  })

  it('returns an empty array for a document with no references', () => {
    expect(extractReferences('just prose, no links')).toEqual([])
  })
})
