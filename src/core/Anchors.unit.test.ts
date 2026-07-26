import { describe, expect, it } from 'vitest'

import { extractAnchors, isValidLineAnchor, normalizeAnchor, parseLineAnchor } from './Anchors.ts'

describe('extractAnchors()', () => {
  it('slugs ATX headings GitHub-style', () => {
    const anchors = extractAnchors('# Getting Started\n\n## API Reference')
    expect(anchors).toEqual(new Set(['getting-started', 'api-reference']))
  })

  it('slugs setext headings (H1 `===`, H2 `---`)', () => {
    const anchors = extractAnchors('Getting Started\n===============\n\nAPI Reference\n-------------\n')
    expect(anchors).toEqual(new Set(['getting-started', 'api-reference']))
  })

  it('does not mistake a thematic break (`---` after a blank line) for a setext heading', () => {
    const anchors = extractAnchors('# Title\n\n---\n\nSome text.')
    expect(anchors).toEqual(new Set(['title']))
  })

  it('does not misparse a heading-shaped or setext-shaped line inside a fenced code block', () => {
    const anchors = extractAnchors('# Real\n\n```md\n# Fake\nFake2\n===\n```\n')
    expect(anchors).toEqual(new Set(['real']))
  })

  it('preserves Unicode letters (denylist, not an ASCII allowlist)', () => {
    expect(extractAnchors('## Café')).toEqual(new Set(['café']))
    expect(extractAnchors('## Привет')).toEqual(new Set(['привет']))
  })

  it('preserves underscores (common in headings naming code symbols)', () => {
    expect(extractAnchors('## foo_bar')).toEqual(new Set(['foo_bar']))
  })

  it('does not trim or collapse hyphens', () => {
    expect(extractAnchors('## Hello 👋')).toEqual(new Set(['hello-']))
    expect(extractAnchors('## a  b')).toEqual(new Set(['a--b']))
  })

  it('dedupes repeated headings in document order, re-checking numbered candidates against the seen set', () => {
    // A heading that collides with an already-numbered slug from an unrelated
    // heading must still be re-numbered past it, not just incremented once.
    const anchors = extractAnchors('# Foo\n# Foo\n# Foo-1\n# Foo')
    expect(anchors).toEqual(new Set(['foo', 'foo-1', 'foo-1-1', 'foo-2']))
  })

  it('reduces an inline link/image inside a heading to its own text/alt before slugging', () => {
    expect(extractAnchors('## [The API](./x.md)')).toEqual(new Set(['the-api']))
    expect(extractAnchors('## ![diagram](./d.png) Overview')).toEqual(new Set(['diagram-overview']))
  })

  it('decodes HTML entities before slugging', () => {
    expect(extractAnchors('## Q&amp;A')).toEqual(new Set(['qa']))
  })

  it('harvests explicit HTML anchors verbatim (not slugged)', () => {
    const anchors = extractAnchors('<a id="Custom-Anchor"></a>\n\n# Heading')
    expect(anchors.has('Custom-Anchor')).toBeTruthy()
    expect(anchors.has('heading')).toBeTruthy()
  })

  it('harvests <a name="..."> the same way as <a id="...">', () => {
    expect(extractAnchors('<a name="legacy"></a>').has('legacy')).toBeTruthy()
  })

  it('returns an empty set for a document with no headings or HTML anchors', () => {
    expect(extractAnchors('just some prose.')).toEqual(new Set())
  })
})

describe('normalizeAnchor()', () => {
  it('decodes a percent-encoded anchor', () => {
    expect(normalizeAnchor('getting%20started')).toBe('getting started')
  })

  it('returns the input unchanged for malformed percent-encoding rather than throwing', () => {
    expect(normalizeAnchor('100%')).toBe('100%')
  })
})

describe('parseLineAnchor()', () => {
  it('parses a single line anchor', () => {
    expect(parseLineAnchor('L42')).toEqual({ end: 42, start: 42 })
  })

  it('parses a line range', () => {
    expect(parseLineAnchor('L10-L20')).toEqual({ end: 20, start: 10 })
  })

  it('rejects an inverted range', () => {
    expect(parseLineAnchor('L20-L10')).toBeNull()
  })

  it('rejects non-line-shaped anchors (e.g. a symbol anchor)', () => {
    expect(parseLineAnchor('someExport')).toBeNull()
    expect(parseLineAnchor('L0')).toBeNull()
  })
})

describe('isValidLineAnchor()', () => {
  it('accepts a range within the file', () => {
    expect(isValidLineAnchor({ end: 20, start: 10 }, 25)).toBeTruthy()
  })

  it('rejects a range past the end of the file', () => {
    expect(isValidLineAnchor({ end: 30, start: 10 }, 25)).toBeFalsy()
  })

  it('accepts a range ending exactly at the last line', () => {
    expect(isValidLineAnchor({ end: 25, start: 25 }, 25)).toBeTruthy()
  })
})
