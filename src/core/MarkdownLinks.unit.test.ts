import { describe, expect, it } from 'vitest'

import {
  buildBasenameIndex,
  checkContent,
  extractLinks,
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
    expect(isCheckableTarget('#section')).toBeFalsy()
    expect(isCheckableTarget('')).toBeFalsy()
    expect(isCheckableTarget('//cdn.example.com/x')).toBeFalsy()
  })

  it('accepts relative paths', () => {
    expect(isCheckableTarget('./a.md')).toBeTruthy()
    expect(isCheckableTarget('../a/b.md')).toBeTruthy()
    expect(isCheckableTarget('sub/dir/')).toBeTruthy()
  })
})

describe('stripAnchor()', () => {
  it('removes hash anchors and query strings', () => {
    expect(stripAnchor('a.md#sec')).toBe('a.md')
    expect(stripAnchor('a.md?x=1')).toBe('a.md')
    expect(stripAnchor('a.md')).toBe('a.md')
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
    expect(result.map((r) => r.target)).toEqual(['./missing.md'])
  })

  it('ignores anchors when resolving existence', () => {
    const content = '[ok](./exists.md#heading)'
    expect(checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })).toEqual([])
  })

  it('attaches a suggested fix when provided an index', () => {
    const index = buildBasenameIndex(['/r/docs/b/missing.md'])
    const content = '[dead](./missing.md)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md', index })
    expect(result[0]?.suggestion).toBe('../b/missing.md')
  })

  it('does not flag links that only appear inside code examples', () => {
    const content = [
      'Here is an example:',
      '```md',
      '[demo](./does-not-exist.md)',
      '```',
      'and `[inline](./nope.md)`',
    ].join('\n')
    expect(checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })).toEqual([])
  })

  it('flags a broken reference-style link definition, with a suggestion', () => {
    const index = buildBasenameIndex(['/r/docs/b/missing.md'])
    const content = 'See [the doc][d].\n\n[d]: ./missing.md'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md', index })
    expect(result.map((r) => r.target)).toEqual(['./missing.md'])
    expect(result[0]?.suggestion).toBe('../b/missing.md')
  })

  it('accepts a reference definition whose target exists', () => {
    const content = '[ok][e]\n\n[e]: ./exists.md'
    expect(checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })).toEqual([])
  })
})
