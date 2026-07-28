import { describe, expect, it } from 'vitest'

import {
  describeAnchors,
  extractAnchors,
  extractHeadingsWithPosition,
  isValidLineAnchor,
  normalizeAnchor,
  parseLineAnchor,
  suggestAnchorFix,
} from './Anchors.ts'

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

  // A structural sibling of MarkdownLinks.ts's own LINK_RE ReDoS fix, found
  // by auditing for the same unbounded `[^\]]*`/`[^)\s]+` shape elsewhere in
  // the codebase (CodeQL flagged LINK_RE specifically; this one wasn't
  // flagged, but is exploitable the same way — same style/threshold as that
  // fix's regression test).
  it('stays fast slugging a heading with many unclosed brackets (no closing `]` anywhere)', () => {
    const adversarial = `# ${'\\['.repeat(80_000)}`
    const start = performance.now()
    extractAnchors(adversarial)
    const elapsedMs = performance.now() - start
    // Bounded implementation measured ~250ms locally; the UNBOUNDED (pre-fix)
    // shape measured ~5s on this same input — a ~20x gap, so 3s leaves
    // healthy margin for a slower/shared CI runner (matching MarkdownLinks.ts's
    // own ReDoS test, which really did flake once at a tighter threshold)
    // while still reliably catching a regression back to unbounded.
    expect(elapsedMs).toBeLessThan(3000)
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

// Additive: same slugging/dedup behaviour as extractAnchors(), plus each
// heading's level and 1-indexed line number — needed by
// ../structure/DocMetadata.ts. extractAnchors() itself is untouched.
describe('extractHeadingsWithPosition()', () => {
  it('reports ATX heading level and 1-indexed line, in document order', () => {
    expect(extractHeadingsWithPosition('# Getting Started\n\n## API Reference')).toEqual([
      { level: 1, line: 1, slug: 'getting-started', text: 'Getting Started' },
      { level: 2, line: 3, slug: 'api-reference', text: 'API Reference' },
    ])
  })

  it('reports a setext heading at the line the TEXT itself is on (not the underline)', () => {
    expect(extractHeadingsWithPosition('Getting Started\n===============')).toEqual([
      { level: 1, line: 1, slug: 'getting-started', text: 'Getting Started' },
    ])
    expect(extractHeadingsWithPosition('API Reference\n-------------')).toEqual([
      { level: 2, line: 1, slug: 'api-reference', text: 'API Reference' },
    ])
  })

  it('dedupes slugs the same way extractAnchors() does, in document order', () => {
    expect(extractHeadingsWithPosition('# Foo\n# Foo')).toEqual([
      { level: 1, line: 1, slug: 'foo', text: 'Foo' },
      { level: 1, line: 2, slug: 'foo-1', text: 'Foo' },
    ])
  })

  it('returns an empty array for a document with no headings', () => {
    expect(extractHeadingsWithPosition('just some prose.')).toEqual([])
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

describe('describeAnchors()', () => {
  it('lists every anchor when few enough', () => {
    expect(describeAnchors(new Set(['intro', 'setup']))).toBe('available anchors: intro, setup')
  })

  it('says so when a document has no anchors at all', () => {
    expect(describeAnchors(new Set())).toBe('target has no headings or anchors')
  })

  it('caps a long list and states how many more there are, rather than dumping everything', () => {
    const anchors = new Set(Array.from({ length: 12 }, (_, i) => `heading-${i}`))
    const description = describeAnchors(anchors)
    expect(description).toBe(
      'available anchors: heading-0, heading-1, heading-2, heading-3, heading-4, heading-5, heading-6, heading-7, and 4 more',
    )
  })
})

describe('suggestAnchorFix()', () => {
  it('finds an exact case-insensitive match against a real slug', () => {
    expect(suggestAnchorFix('Setup-Pattern', new Set(['setup-pattern', 'other']))).toBe('setup-pattern')
  })

  it('returns null when no anchor matches even case-insensitively', () => {
    expect(suggestAnchorFix('nope', new Set(['setup-pattern']))).toBeNull()
  })

  it('returns null (never picks one) when two anchors case-collide — the ambiguity guard', () => {
    // Only reachable via verbatim-kept HTML anchors (extractAnchors never
    // lowercases <a id="...">) — two distinct real anchors differing only
    // by case is a genuine, if rare, ambiguity.
    expect(suggestAnchorFix('FOO', new Set(['Foo', 'foo']))).toBeNull()
  })

  it('is exact, not fuzzy — a near-miss is never "corrected" (issue #49: fuzzy matching explicitly out of scope)', () => {
    expect(suggestAnchorFix('setup-patterns', new Set(['setup-pattern']))).toBeNull()
  })
})
