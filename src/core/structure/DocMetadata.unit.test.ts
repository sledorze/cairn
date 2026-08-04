import { describe, expect, it } from 'vitest'

import { extractDocMetadata, lineStarts, offsetToLine, parseFrontmatter } from './DocMetadata.ts'

describe('lineStarts() / offsetToLine()', () => {
  it('maps offset 0 to line 1 for single-line content', () => {
    const starts = lineStarts('abc')
    expect(offsetToLine(starts, 0)).toBe(1)
    expect(offsetToLine(starts, 2)).toBe(1)
  })

  it('maps an offset on each line correctly for multi-line content', () => {
    const content = 'a\nbb\nccc'
    const starts = lineStarts(content)
    expect(offsetToLine(starts, 0)).toBe(1) // 'a'
    expect(offsetToLine(starts, 2)).toBe(2) // 'b' (first b)
    expect(offsetToLine(starts, 5)).toBe(3) // 'c' (first c)
  })

  it('maps an offset exactly at a line-start boundary to that line, not the previous one', () => {
    const content = 'a\nb'
    const starts = lineStarts(content)
    // offset 2 is the 'b', i.e. exactly where line 2 starts.
    expect(offsetToLine(starts, 2)).toBe(2)
  })
})

describe('extractDocMetadata()', () => {
  const kinds = [
    { id: 'feature', select: { by: 'path' as const, glob: 'product/features/**' } },
    { id: 'decision', select: { by: 'path' as const, glob: 'docs/adr/**' } },
  ]

  it('classifies a doc by path glob into `kinds`', () => {
    const meta = extractDocMetadata({ content: '# Title', kinds, path: 'product/features/foo.md' })
    expect(meta.kinds).toEqual(['feature'])
  })

  it('returns an empty `kinds` array for a doc matching no declared kind — never a nullable singular', () => {
    const meta = extractDocMetadata({ content: '# Title', kinds, path: 'random/notes.md' })
    expect(meta.kinds).toEqual([])
  })

  it('lists every matching kind when more than one selector matches the same doc', () => {
    const overlapping = [
      { id: 'feature', select: { by: 'path' as const, glob: 'product/**' } },
      { id: 'draft', select: { by: 'path' as const, glob: '**/features/**' } },
    ]
    const meta = extractDocMetadata({ content: '# Title', kinds: overlapping, path: 'product/features/foo.md' })
    expect(meta.kinds).toEqual(['feature', 'draft'])
  })

  it('returns headings and refs as ONE sequence, in real document order — not two separate arrays', () => {
    const content = '# Intro\n\nsee [x](./a.md)\n\n## Details\n\nsee [y](./b.md)'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes.map((n) => n.tag)).toEqual(['heading', 'ref', 'heading', 'ref'])
  })

  it('gives each heading its level, 1-indexed line, and slug', () => {
    const content = '# Intro\n\n## Details'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([
      { level: 1, line: 1, slug: 'intro', tag: 'heading', text: 'Intro' },
      { level: 2, line: 3, slug: 'details', tag: 'heading', text: 'Details' },
    ])
  })

  it('gives each ref its target, anchor, and 1-indexed line', () => {
    const content = 'line one\n\nsee [x](./a.md#sec)'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([{ anchor: 'sec', line: 3, tag: 'ref', target: './a.md' }])
  })

  it('excludes external (non-checkable) targets from ref nodes, same scope as extractReferences()', () => {
    const meta = extractDocMetadata({ content: 'see [x](https://example.com)', kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([])
  })

  it('excludes a bare same-page anchor link — a position within THIS doc, not a reference to another one', () => {
    const content = '# Heading\n\nsee [above](#heading)'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([{ level: 1, line: 1, slug: 'heading', tag: 'heading', text: 'Heading' }])
  })

  // A heading whose own text contains an inline link is BOTH a heading (for
  // slugging) and a real outbound reference (the link genuinely points
  // somewhere) — both facts are true, so both node kinds are emitted, on
  // the same line. Tie-break: heading first, since it starts the section
  // the link's own line belongs to.
  it('emits both a heading node and a ref node, heading first, when a heading contains an inline link', () => {
    const meta = extractDocMetadata({ content: '# [Home](./home.md)', kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([
      // `text` is the RAW heading text (matches Anchors.ts's own contract —
      // only `slug` is flattened, same as extractAnchors()'s own slugging).
      { level: 1, line: 1, slug: 'home', tag: 'heading', text: '[Home](./home.md)' },
      { anchor: null, line: 1, tag: 'ref', target: './home.md' },
    ])
  })

  it('returns an empty `nodes` array for a doc with no headings and no refs', () => {
    const meta = extractDocMetadata({ content: 'just prose.', kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([])
  })

  // Regression coverage reusing this session's own recent link-parsing fix:
  // an angle-bracket-wrapped destination with internal parens must still be
  // recognized as a real ref, not silently dropped or truncated.
  it('handles an angle-bracket-wrapped destination with internal parens (regression: issue found this session)', () => {
    const content = 'see [x](<./a_(b).md>)'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([{ anchor: null, line: 1, tag: 'ref', target: './a_(b).md' }])
  })

  // Adversarial finding: a reference-style link (`[text][ref]` + a separate
  // `[ref]: target` definition line) previously produced NO ref node at
  // all — `extractDocMetadata` only ever called `extractLinksWithPosition`,
  // never `extractLinkDefinitionsWithPosition`, unlike
  // `MarkdownLinks.ts`'s own `extractReferences` (used by CheckRefs.ts),
  // which already combines both. A doc using this real, common Markdown
  // shape was silently invisible to `checks.coverage` — reported as
  // missing coverage despite a correct link, and its target reported
  // orphaned despite a real inbound reference. The ref node is emitted at
  // the DEFINITION's line (the only place the target/position pair
  // exists), matching `extractReferences`'s own "the definition itself is
  // the reference" treatment.
  it('emits a ref node for a reference-style link, at the DEFINITION line, not the usage line', () => {
    const content = 'see [impl][ref] for details\n\n[ref]: ../src/foo.ts'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([{ anchor: null, line: 3, tag: 'ref', target: '../src/foo.ts' }])
  })

  it('emits one ref node per reference-style definition, in document order alongside inline refs', () => {
    const content = '[inline](./a.md)\n\n[ref]: ./b.md'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes.map((n) => (n.tag === 'ref' ? n.target : null))).toEqual(['./a.md', './b.md'])
  })

  it('never emits a ref node for an unresolvable reference-style target (e.g. a bare fragment)', () => {
    const content = 'see [x][ref]\n\n[ref]: #section'
    const meta = extractDocMetadata({ content, kinds: [], path: 'docs/x.md' })
    expect(meta.nodes).toEqual([])
  })

  // `by: 'frontmatter'` — a real gap this repo's own ADRs exposed: every
  // ADR shares one path glob (docs/adr/*.md) but carries a real structural
  // distinction (`status: proposed` vs `status: accepted`) that path alone
  // can't express.
  describe('kind classification by frontmatter (`by: "frontmatter"`)', () => {
    const statusKinds = [
      { id: 'accepted-adr', select: { by: 'frontmatter' as const, equals: 'accepted', field: 'status' } },
      { id: 'proposed-adr', select: { by: 'frontmatter' as const, equals: 'proposed', field: 'status' } },
    ]

    it('classifies a doc by a frontmatter field/value match', () => {
      const content = '---\nstatus: accepted\n---\n\n# Decision'
      const meta = extractDocMetadata({ content, kinds: statusKinds, path: 'docs/adr/0001-x.md' })
      expect(meta.kinds).toEqual(['accepted-adr'])
    })

    it('does not classify a doc whose frontmatter field has a different value', () => {
      const content = '---\nstatus: proposed\n---\n\n# Decision'
      const meta = extractDocMetadata({ content, kinds: statusKinds, path: 'docs/adr/0001-x.md' })
      expect(meta.kinds).toEqual(['proposed-adr'])
    })

    it('returns no kind, not an error, for a doc with no frontmatter block at all', () => {
      const meta = extractDocMetadata({
        content: '# Decision, no frontmatter',
        kinds: statusKinds,
        path: 'docs/adr/0001-x.md',
      })
      expect(meta.kinds).toEqual([])
    })

    it('returns no kind for a frontmatter block missing the selector field', () => {
      const content = '---\ntitle: Something\n---\n\n# Decision'
      const meta = extractDocMetadata({ content, kinds: statusKinds, path: 'docs/adr/0001-x.md' })
      expect(meta.kinds).toEqual([])
    })

    it('combines with a `by: "path"` kind on the same doc — one doc, two independent selectors, both can match', () => {
      const mixedKinds = [...statusKinds, { id: 'adr', select: { by: 'path' as const, glob: 'docs/adr/**' } }]
      const content = '---\nstatus: accepted\n---\n\n# Decision'
      const meta = extractDocMetadata({ content, kinds: mixedKinds, path: 'docs/adr/0001-x.md' })
      expect(meta.kinds).toEqual(['accepted-adr', 'adr'])
    })
  })
})

describe('parseFrontmatter()', () => {
  it('parses flat key: value pairs from a leading frontmatter block', () => {
    const content = '---\nstatus: accepted\ntitle: Some Title\n---\n\nBody text'
    expect(parseFrontmatter(content)).toEqual(
      new Map([
        ['status', 'accepted'],
        ['title', 'Some Title'],
      ]),
    )
  })

  it("strips a quoted value's surrounding quotes", () => {
    const content = "---\nstatus: 'accepted'\n---\n"
    expect(parseFrontmatter(content).get('status')).toBe('accepted')
  })

  it('returns an empty map for content with no frontmatter block', () => {
    expect(parseFrontmatter('# Just a heading\n\nprose')).toEqual(new Map())
  })

  it('returns an empty map when the frontmatter delimiter is not at the very start of the content', () => {
    expect(parseFrontmatter('\n---\nstatus: accepted\n---\n')).toEqual(new Map())
  })

  it('skips a non-`key: value` line inside the frontmatter block (e.g. a blank line) without erroring', () => {
    const content = '---\nstatus: accepted\n\ntitle: Some Title\n---\n'
    expect(parseFrontmatter(content)).toEqual(
      new Map([
        ['status', 'accepted'],
        ['title', 'Some Title'],
      ]),
    )
  })
})
