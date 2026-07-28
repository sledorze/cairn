import { describe, expect, it } from 'vitest'

import {
  buildBasenameIndex,
  checkContent,
  extractLinks,
  extractLinksWithPosition,
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

  // Real, reported bug: a `<...>`-wrapped destination is CommonMark's own
  // way to let a URL contain a literal `)` without it being confused for the
  // link's own closing paren (a real, not-uncommon shape — Wikipedia/
  // LibreTexts-style URLs). The bare-form heuristic (stop at the first
  // unescaped `)`) must never run against this delimited form — it needs to
  // read verbatim to the matching `>` first.
  it('reads an angle-bracket-wrapped destination verbatim, parens and all', () => {
    expect(extractLinks('[A Link](<https://example.com/path_(with_parens)/more>)')).toEqual([
      { target: 'https://example.com/path_(with_parens)/more', text: 'A Link' },
    ])
  })

  it('still supports a title after an angle-bracket-wrapped destination', () => {
    expect(extractLinks('[t](<https://example.com/x_(y)/z> "a title")')).toEqual([
      { target: 'https://example.com/x_(y)/z', text: 't' },
    ])
  })

  // Broader than the reported symptom: the OLD regex captured the `<`/`>`
  // delimiters AS PART OF the target (`<https://example.com/simple>`), so
  // even a wrapped destination with NO internal parens at all had a target
  // starting with `<` rather than `https:` — breaking `isCheckableTarget`'s
  // scheme detection and false-flagging ANY angle-wrapped external URL as a
  // dead local path, not just ones containing `)`. The fix strips the
  // delimiters, not just fixes paren-truncation.
  it('strips the angle-bracket delimiters themselves, not just fixes paren-truncation', () => {
    expect(extractLinks('[t](<https://example.com/simple>)')).toEqual([
      { target: 'https://example.com/simple', text: 't' },
    ])
  })

  // Deliberately UNCHANGED: a BARE (non-angle) destination with an internal,
  // unescaped `)` is genuinely ambiguous per CommonMark itself — `<...>` is
  // the spec's own way to disambiguate it. This pins that the fix above is
  // scoped to the angle-bracket form only, not a general paren-balancing
  // change to the bare-form heuristic.
  it('still stops a BARE (non-angle) destination at its first unescaped paren', () => {
    expect(extractLinks('[t](./path_(with_parens).md)')).toEqual([{ target: './path_(with_parens', text: 't' }])
  })

  // Pins the `\s+` (one-or-more) title separator: a single-space mutant
  // (`\s`) fails to match at all when more than one whitespace char
  // separates the destination from its title — the whole link would be
  // silently dropped (not merely mis-parsed), for both destination forms.
  it('tolerates more than one whitespace char before a title, bare or angle-bracket form', () => {
    expect(extractLinks('[t](./a.md  "title")')).toEqual([{ target: './a.md', text: 't' }])
    expect(extractLinks('[t](<https://x.com/y>  "title")')).toEqual([{ target: 'https://x.com/y', text: 't' }])
  })

  // An empty angle-bracket destination (`<>`) captures group 2 as `''`
  // (defined), never `undefined` — pins `linkTarget`'s structural claim that
  // the angle form's capture is never absent, only possibly empty.
  it('handles an empty angle-bracket destination as an empty-string target, not a crash', () => {
    expect(extractLinks('[t](<>)')).toEqual([{ target: '', text: 't' }])
  })

  // CodeQL flagged LINK_RE as js/polynomial-redos — a real, pre-existing
  // quadratic blowup (confirmed empirically, not just by the analyzer:
  // unbounded, ~4x time per 2x input), triggered by content with many `[`-
  // like sequences but no closing `]` — plausible in real, messy or
  // adversarial Markdown, not a toy case. Every unbounded quantifier in
  // LINK_RE is now capped at a generous 2000 chars; same style/threshold as
  // `stripAnchor()`'s own ReDoS regression test below.
  it('stays fast scanning content with many unclosed brackets (no closing `]` anywhere)', () => {
    const adversarial = '\\['.repeat(80_000)
    const start = performance.now()
    extractLinks(adversarial)
    const elapsedMs = performance.now() - start
    // A GENEROUS bound, not a tight perf assertion — the point is catching a
    // regression back to quadratic (which would blow well past this on the
    // SAME input: the pre-fix regex took ~2.4s on a mere 80 000-char version
    // of this adversarial string locally, and quadratic scaling would put
    // this 160 000-char one at ~4x that). 5s leaves ample headroom for a
    // slower/shared CI runner (a real, not hypothetical, source of flakiness
    // — this exact assertion flaked once at ~1.05s against a 1s threshold).
    expect(elapsedMs).toBeLessThan(5000)
  })
})

// Additive: same extraction as extractLinks(), plus each match's character
// offset — needed by ../structure/DocMetadata.ts to convert a link's
// position into a line number. extractLinks() itself is untouched (still
// no position field), so every existing caller is unaffected.
describe('extractLinksWithPosition()', () => {
  it('extracts the same target/text as extractLinks(), plus each link’s character offset', () => {
    const md = 'see [home](./a.md) and [other](../b/c.md).'
    expect(extractLinksWithPosition(md)).toEqual([
      { index: 4, target: './a.md', text: 'home' },
      { index: 23, target: '../b/c.md', text: 'other' },
    ])
  })

  it('returns an empty array when there are no links', () => {
    expect(extractLinksWithPosition('plain text, no links')).toEqual([])
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

  // End-to-end pin of the reported bug, at the level a real scan actually
  // sees it: an angle-bracket-wrapped external URL (parens or not) must be
  // recognized as external (`isCheckableTarget` false) and never appear in
  // `broken` — before the fix, the leaked `<` made it look like an in-root
  // relative path, and it was reported broken with a truncated target.
  it('never flags an angle-bracket-wrapped external URL as broken, even with internal parens', () => {
    const content = '[A Link](<https://example.com/path_(with_parens)/more>) [Simple](<https://example.com/simple>)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([])
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

  // Issue #49: same-page anchor repair — an exact case-insensitive match
  // against the SOURCE file's own headings gets a `suggestion` (the full
  // corrected `#fragment` target), the same repairable shape path-fix uses.
  it('suggests a fix for a same-page anchor that differs from a real heading only by case', () => {
    const content = '# Setup Pattern\n\nsee [it](#Setup-Pattern)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken).toEqual([
      {
        detail: 'available anchors: setup-pattern',
        reason: 'anchor',
        suggestion: '#setup-pattern',
        target: '#Setup-Pattern',
        text: 'it',
      },
    ])
  })

  it('does NOT suggest a fix for a same-page anchor with no real match (no suggestion key at all)', () => {
    const content = '# Real Heading\n\nsee [ghost](#not-a-real-heading)'
    const result = checkContent({ content, existsAbs, fileAbs: '/r/docs/a/file.md' })
    expect(result.broken[0]).not.toHaveProperty('suggestion')
  })

  // Found via adversarial review of issue #49: the cross-file anchor path
  // (CheckLinks.ts) already normalizes (percent-decodes) before comparing —
  // this same-page path must match, or a URL-encoded fragment would neither
  // resolve when it legitimately should, nor get a fix suggestion.
  it('percent-decodes a same-page anchor before matching AND before suggesting a fix', () => {
    // Percent-encoded but otherwise an EXACT match (no case difference at
    // all) — must resolve cleanly once decoded, no suggestion needed.
    const resolves = checkContent({
      content: '# Setup Pattern\n\n[ok](#setup%2Dpattern)',
      existsAbs,
      fileAbs: '/r/docs/a/file.md',
    })
    expect(resolves.broken).toEqual([])

    // Percent-encoded AND a case difference — must decode first, then apply
    // the same exact-case-insensitive-match repair rule.
    const withEncodedCase = checkContent({
      content: '# Setup Pattern\n\n[ok](#Setup%2DPattern)',
      existsAbs,
      fileAbs: '/r/docs/a/file.md',
    })
    expect(withEncodedCase.broken).toEqual([
      {
        detail: 'available anchors: setup-pattern',
        reason: 'anchor',
        suggestion: '#setup-pattern',
        target: '#Setup%2DPattern',
        text: 'ok',
      },
    ])
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
