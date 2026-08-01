import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
import { applyFixesToFile, checkLinks, formatLinkReport, linkExitCode } from './CheckLinks.ts'

describe('formatLinkReport()', () => {
  it('reports success with the checked count (English by default)', () => {
    expect(formatLinkReport({ broken: [], checked: 7, fixed: 0, unreadable: [] })).toEqual([
      '✅ Markdown links OK (7 file(s) checked).',
    ])
  })

  it('localises to French when asked', () => {
    expect(formatLinkReport({ broken: [], checked: 7, fixed: 0, unreadable: [] }, { locale: 'fr' })).toEqual([
      '✅ Liens Markdown OK (7 fichier(s) vérifié(s)).',
    ])
  })

  it('lists broken links with suggestions and a fix note', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ suggestion: '../b/x.md', target: './x.md', text: 't' }] }],
      checked: 3,
      fixed: 1,
      unreadable: [],
    })
    expect(lines[0]).toBe('🔧 Auto-repaired 1 link(s).')
    expect(lines).toContain('  a.md')
    expect(lines.at(-1)).toBe('    ✗ [t](./x.md) → suggestion: ../b/x.md')
  })

  // issue #39: an anchor/line failure must never read as "(no unique target)"
  // — that hint means "the path itself has no unambiguous replacement," which
  // is misleading when the path resolves fine and only the fragment is wrong.
  it('gives an anchor-specific hint, distinct from a path-suggestion miss', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ reason: 'anchor', target: './b.md#nope', text: 't' }] }],
      checked: 1,
      fixed: 0,
      unreadable: [],
    })
    expect(lines.at(-1)).toBe('    ✗ [t](./b.md#nope) (heading/anchor not found)')
  })

  it('gives a line-specific hint', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ reason: 'line', target: '../x.ts#L999', text: 't' }] }],
      checked: 1,
      fixed: 0,
      unreadable: [],
    })
    expect(lines.at(-1)).toBe('    ✗ [t](../x.ts#L999) (line number out of range)')
  })

  // "meaningful and actionable": what's actually there, not just "wrong."
  it('appends detail to the anchor hint so the fix is visible without opening the file', () => {
    const lines = formatLinkReport({
      broken: [
        {
          file: 'a.md',
          links: [{ detail: 'available anchors: intro, setup', reason: 'anchor', target: './b.md#nope', text: 't' }],
        },
      ],
      checked: 1,
      fixed: 0,
      unreadable: [],
    })
    expect(lines.at(-1)).toBe('    ✗ [t](./b.md#nope) (heading/anchor not found — available anchors: intro, setup)')
  })

  it('appends detail to the line hint', () => {
    const lines = formatLinkReport({
      broken: [
        { file: 'a.md', links: [{ detail: 'target has 5 lines', reason: 'line', target: '../x.ts#L999', text: 't' }] },
      ],
      checked: 1,
      fixed: 0,
      unreadable: [],
    })
    expect(lines.at(-1)).toBe('    ✗ [t](../x.ts#L999) (line number out of range — target has 5 lines)')
  })

  it('still reports "(no unique target)" for a path failure with no suggestion', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ reason: 'path', target: './ghost.md', text: 't' }] }],
      checked: 1,
      fixed: 0,
      unreadable: [],
    })
    expect(lines.at(-1)).toBe('    ✗ [t](./ghost.md) (no unique target)')
  })

  // Found via adversarial "no unhandled exception" review — a permission-
  // denied doc must be reported clearly, never silently, and never crash.
  it('reports unreadable files, and does NOT print the success line when any exist', () => {
    const lines = formatLinkReport({ broken: [], checked: 1, fixed: 0, unreadable: ['docs/b.md'] })
    expect(lines).toEqual(['⚠️  1 file(s) could not be read (permission denied?):', '  ✗ docs/b.md'])
  })

  it('reports both unreadable files AND broken links together', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ reason: 'path', target: './ghost.md', text: 't' }] }],
      checked: 1,
      fixed: 0,
      unreadable: ['docs/b.md'],
    })
    expect(lines[0]).toBe('⚠️  1 file(s) could not be read (permission denied?):')
    expect(lines[1]).toBe('  ✗ docs/b.md')
    expect(lines.at(-1)).toBe('    ✗ [t](./ghost.md) (no unique target)')
  })
})

describe('linkExitCode()', () => {
  it('is 1 when there are unreadable files, even with zero broken links', () => {
    expect(linkExitCode({ broken: [], checked: 1, fixed: 0, unreadable: ['docs/b.md'] })).toBe(1)
  })

  it('is 0 when both broken and unreadable are empty', () => {
    expect(linkExitCode({ broken: [], checked: 1, fixed: 0, unreadable: [] })).toBe(0)
  })
})

// Pure, no DocsFs/Effect needed — extracted out of checkLinks's Effect.gen
// block specifically to be independently unit-testable (TDD: the fix for
// issue #49's repeated-target misreport now has its own direct test surface,
// not just proven indirectly via checkLinks()'s end-to-end tests below).
describe('applyFixesToFile()', () => {
  it('reports links unchanged when fix is off, even with a suggestion available', () => {
    const links = [{ suggestion: '../b/x.md', target: './x.md', text: 't' }]
    const result = applyFixesToFile('[t](./x.md)', links, false)
    expect(result).toEqual({ changed: false, content: '[t](./x.md)', fixed: 0, remaining: links })
  })

  it('applies a single unambiguous fix', () => {
    const result = applyFixesToFile('[t](./x.md)', [{ suggestion: '../b/x.md', target: './x.md', text: 't' }], true)
    expect(result).toEqual({ changed: true, content: '[t](../b/x.md)', fixed: 1, remaining: [] })
  })

  it('leaves a link with no suggestion unfixed, reported in `remaining`', () => {
    const link = { reason: 'path' as const, target: './ghost.md', text: 't' }
    const result = applyFixesToFile('[t](./ghost.md)', [link], true)
    expect(result).toEqual({ changed: false, content: '[t](./ghost.md)', fixed: 0, remaining: [link] })
  })

  // The direct regression test for issue #49's dimension-coverage fix — the
  // one this function was extracted specifically to make directly testable.
  it('fixes the SAME target repeated twice, counting both as fixed (not just the first)', () => {
    const content = 'First: [a](./x.md) Second: [b](./x.md)'
    const links = [
      { suggestion: '../b/x.md', target: './x.md', text: 'a' },
      { suggestion: '../b/x.md', target: './x.md', text: 'b' },
    ]
    const result = applyFixesToFile(content, links, true)
    expect(result).toEqual({
      changed: true,
      content: 'First: [a](../b/x.md) Second: [b](../b/x.md)',
      fixed: 2,
      remaining: [],
    })
  })

  // Found via adversarial review of this very extraction: `applyFix` reports
  // `changed: true` whenever it performed a literal replace, even when the
  // replacement text is IDENTICAL to the original (target === suggestion) —
  // a textual no-op that still "succeeded." The caller in `checkLinks` must
  // decide whether to write the file from `changed` (this field), NOT from
  // comparing `content` to the original string — those two signals can
  // legitimately disagree, and only `changed` reflects what `applyFix`
  // itself considers a successful repair. (`target === suggestion` cannot
  // arise from `suggestFix`/`suggestAnchorFix` in real usage — a suggestion
  // is only ever produced for something that currently fails resolution,
  // while the target this exact case models already resolves — but nothing
  // in the type system prevents a future/differently-sourced `BrokenLink`
  // from doing it, so this pins the contract explicitly rather than leaving
  // it as an unstated invariant.)
  it('reports `changed: true` even when the suggestion is textually identical to the target (a no-op replace)', () => {
    const result = applyFixesToFile('[t](./x.md)', [{ suggestion: './x.md', target: './x.md', text: 't' }], true)
    expect(result.changed).toBeTruthy()
    expect(result.fixed).toBe(1)
    expect(result.content).toBe('[t](./x.md)') // textually unchanged, but still a "successful" fix
  })

  it('fixes the SAME target repeated three times', () => {
    const content = '[a](./x.md) [b](./x.md) [c](./x.md)'
    const links = ['a', 'b', 'c'].map((text) => ({ suggestion: '../b/x.md', target: './x.md', text }))
    const result = applyFixesToFile(content, links, true)
    expect(result.fixed).toBe(3)
    expect(result.remaining).toEqual([])
    expect(result.content).toBe('[a](../b/x.md) [b](../b/x.md) [c](../b/x.md)')
  })

  it('does not fix a target that also appears inside a code span (occurrence-safety), even when repeated', () => {
    const content = '[a](./x.md) [b](./x.md)\n\n```md\n[demo](./x.md)\n```'
    const links = [
      { suggestion: '../b/x.md', target: './x.md', text: 'a' },
      { suggestion: '../b/x.md', target: './x.md', text: 'b' },
    ]
    const result = applyFixesToFile(content, links, true)
    expect(result.fixed).toBe(0)
    expect(result.remaining).toEqual(links)
    expect(result.content).toBe(content)
  })

  it('mixes a fixable and an unfixable link in the same file, unrelated targets', () => {
    const content = '[a](./x.md) [b](./ghost.md)'
    const links = [
      { suggestion: '../b/x.md', target: './x.md', text: 'a' },
      { reason: 'path' as const, target: './ghost.md', text: 'b' },
    ]
    const result = applyFixesToFile(content, links, true)
    expect(result.fixed).toBe(1)
    expect(result.remaining).toEqual([links[1]])
    expect(result.content).toBe('[a](../b/x.md) [b](./ghost.md)')
  })

  // Distinct from the "no suggestion" test above: this exercises an empty
  // `links` array specifically, confirming `changed` stays `false` — the
  // signal `checkLinks` uses to decide whether to call `dfs.writeFile` at
  // all — not just that `content`/`remaining` happen to look untouched.
  it('reports `changed: false` for an empty links array (nothing to touch at all)', () => {
    const result = applyFixesToFile('no links here', [], true)
    expect(result).toEqual({ changed: false, content: 'no links here', fixed: 0, remaining: [] })
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
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )

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
    const first = await Effect.runPromise(
      checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )

    expect(first.fixed).toBe(1)
    expect(first.broken[0]?.links.map((l) => l.target)).toEqual(['./nope.md'])

    // Re-running against the same (mutated) layer proves the fix was written.
    const second = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(second.broken[0]?.links.map((l) => l.target)).toEqual(['./nope.md'])
  })

  it('auto-repairs a reference-style link definition', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': { content: 'see [x][d]\n\n[d]: ./moved.md', mtimeMs: 1 },
      '/r/docs/b/moved.md': { content: '# moved', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.fixed).toBe(1)
    expect(result.broken).toEqual([])
    const after = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
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
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
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
      checkLinks({ base: '/r', fix: false, ignore: ['**/vendor/**'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken.map((b) => b.file)).toEqual(['/r/docs/keep.md'])
  })

  // Issue #39, scenario B: cross-file heading anchor.
  it('flags a cross-file anchor that has no matching heading, and leaves a real one alone', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/guide.md': { content: '## Getting Started\n\ntext', mtimeMs: 1 },
      '/r/docs/a/index.md': {
        content: '[intro](./guide.md#getting-started) [bad](./guide.md#nope)',
        mtimeMs: 1,
      },
    })
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toHaveLength(1)
    expect(result.broken[0]?.links).toEqual([
      { detail: 'available anchors: getting-started', reason: 'anchor', target: './guide.md#nope', text: 'bad' },
    ])
  })

  // Issue #39, scenario C: same-file heading anchor.
  it('flags a same-page anchor with no matching heading end to end', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': { content: '# Real Heading\n\nsee [ghost](#not-real)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken[0]?.links).toEqual([
      { detail: 'available anchors: real-heading', reason: 'anchor', target: '#not-real', text: 'ghost' },
    ])
  })

  // Issue #49: anchor auto-repair — exact case-insensitive match, both
  // cross-file and same-file, --fix actually rewrites, is idempotent, and
  // reuses the existing `fixed` counter unchanged.
  describe('anchor auto-repair (--fix, issue #49)', () => {
    it('repairs a cross-file anchor differing from a real heading only by case, and persists the change', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '## Setup Pattern\n\ntext', mtimeMs: 1 },
        '/r/docs/a/index.md': { content: '[link](./guide.md#Setup-Pattern)', mtimeMs: 1 },
      })
      const first = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(first.fixed).toBe(1)
      expect(first.broken).toEqual([])

      // Persisted: re-running (fix off) against the same, now-mutated layer finds nothing broken.
      const second = await Effect.runPromise(
        checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(second.broken).toEqual([])

      const content = await Effect.runPromise(
        Effect.gen(function* () {
          const dfs = yield* DocsFs
          return yield* dfs.readFile('/r/docs/a/index.md')
        }).pipe(Effect.provide(layer)),
      )
      expect(content).toBe('[link](./guide.md#setup-pattern)')
    })

    it('repairs a same-page anchor differing from a real heading only by case', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/index.md': { content: '# Setup Pattern\n\n[link](#Setup-Pattern)', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.fixed).toBe(1)
      expect(result.broken).toEqual([])
      const content = await Effect.runPromise(
        Effect.gen(function* () {
          const dfs = yield* DocsFs
          return yield* dfs.readFile('/r/docs/a/index.md')
        }).pipe(Effect.provide(layer)),
      )
      expect(content).toBe('# Setup Pattern\n\n[link](#setup-pattern)')
    })

    it('is idempotent — running --fix twice reports zero additional fixes the second time', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '## Setup Pattern\n\ntext', mtimeMs: 1 },
        '/r/docs/a/index.md': { content: '[link](./guide.md#Setup-Pattern)', mtimeMs: 1 },
      })
      const first = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(first.fixed).toBe(1)
      const second = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(second.fixed).toBe(0)
      expect(second.broken).toEqual([])
    })

    it('does NOT repair when no anchor matches even case-insensitively — still reported broken, no crash', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '## Real Heading\n\ntext', mtimeMs: 1 },
        '/r/docs/a/index.md': { content: '[link](./guide.md#totally-unrelated)', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.fixed).toBe(0)
      expect(result.broken[0]?.links).toEqual([
        {
          detail: 'available anchors: real-heading',
          reason: 'anchor',
          target: './guide.md#totally-unrelated',
          text: 'link',
        },
      ])
    })

    it('does NOT repair when two real anchors case-collide — the ambiguity guard, end to end', async () => {
      // Two distinct, verbatim-kept HTML anchors differing only by case —
      // extractAnchors never lowercases <a id>, so this is a genuine
      // ambiguity, not a hypothetical one.
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '<a id="Foo"></a>\n<a id="foo"></a>\n', mtimeMs: 1 },
        '/r/docs/a/index.md': { content: '[link](./guide.md#FOO)', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.fixed).toBe(0)
      expect(result.broken[0]?.links[0]).not.toHaveProperty('suggestion')
    })

    it('does NOT repair an anchor break inside a code example, same as path-repair (occurrence-safety)', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '## Setup Pattern\n\ntext', mtimeMs: 1 },
        '/r/docs/a/index.md': {
          content: 'broken [x](./guide.md#Setup-Pattern)\n\n```md\n[demo](./guide.md#Setup-Pattern)\n```',
          mtimeMs: 1,
        },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      // Same target string appears inside a code example too, so applyFix's
      // existing occurrence-count safeguard correctly declines to touch it —
      // reported instead of silently corrupting the code block.
      expect(result.fixed).toBe(0)
      expect(result.broken[0]?.links.map((l) => l.target)).toEqual(['./guide.md#Setup-Pattern'])
    })

    // Found via adversarial dimension-coverage review (not the original test
    // pass): a real misreport, not file corruption — the SAME broken target
    // repeated twice in one file (an ordinary authoring pattern, e.g. a link
    // mentioned in prose and again in a "See also" list) was fully and
    // correctly repaired on disk by ONE `applyFix` call (its replace is
    // global), but the SECOND `BrokenLink` record for that same target
    // string found nothing left to replace and was wrongly reported as
    // still broken — wrong `fixed` count, wrong `broken` list, wrong exit
    // code, on a run that had actually fully succeeded.
    it('repairs a broken anchor target that is repeated TWICE in the same file, reporting both as fixed', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '## Setup Pattern\n\ntext', mtimeMs: 1 },
        '/r/docs/a/index.md': {
          content: 'First: [a](./guide.md#Setup-Pattern)\nSecond: [b](./guide.md#Setup-Pattern)\n',
          mtimeMs: 1,
        },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.fixed).toBe(2)
      expect(result.broken).toEqual([])

      const content = await Effect.runPromise(
        Effect.gen(function* () {
          const dfs = yield* DocsFs
          return yield* dfs.readFile('/r/docs/a/index.md')
        }).pipe(Effect.provide(layer)),
      )
      expect(content).toBe('First: [a](./guide.md#setup-pattern)\nSecond: [b](./guide.md#setup-pattern)\n')

      // Idempotent: re-running against the mutated file finds nothing left.
      const second = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(second.fixed).toBe(0)
      expect(second.broken).toEqual([])
    })

    // Generalizes the TWICE case above to THREE — the fix caches per unique
    // `target` string, so this proves the cache correctly serves every
    // subsequent occurrence, not just a hardcoded "first + second" pairing.
    it('repairs a broken anchor target repeated THREE times in the same file', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '## Setup Pattern\n\ntext', mtimeMs: 1 },
        '/r/docs/a/index.md': {
          content: [
            '[a](./guide.md#Setup-Pattern)',
            '[b](./guide.md#Setup-Pattern)',
            '[c](./guide.md#Setup-Pattern)',
          ].join('\n'),
          mtimeMs: 1,
        },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.fixed).toBe(3)
      expect(result.broken).toEqual([])
      const content = await Effect.runPromise(
        Effect.gen(function* () {
          const dfs = yield* DocsFs
          return yield* dfs.readFile('/r/docs/a/index.md')
        }).pipe(Effect.provide(layer)),
      )
      expect(content).toBe(
        ['[a](./guide.md#setup-pattern)', '[b](./guide.md#setup-pattern)', '[c](./guide.md#setup-pattern)'].join('\n'),
      )
    })

    // The repeated-target cache must not weaken occurrence-safety: a target
    // string appearing BOTH as a real broken link (twice) AND inside a code
    // example must still decline the whole repair, exactly as the
    // single-occurrence case already does — the cache short-circuits on
    // `target` alone, so this proves it doesn't accidentally bypass
    // `applyFix`'s own per-call occurrence-count safeguard.
    it('does NOT repair a target repeated as a real link twice AND once more inside a code example', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/guide.md': { content: '## Setup Pattern\n\ntext', mtimeMs: 1 },
        '/r/docs/a/index.md': {
          content: [
            '[a](./guide.md#Setup-Pattern)',
            '[b](./guide.md#Setup-Pattern)',
            '```md',
            '[demo](./guide.md#Setup-Pattern)',
            '```',
          ].join('\n'),
          mtimeMs: 1,
        },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.fixed).toBe(0)
      expect(result.broken[0]?.links).toHaveLength(2)
    })

    it('repairs a broken PATH target (not just anchor) repeated twice in the same file', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/index.md': {
          content: 'First: [a](./moved.md)\nSecond: [b](./moved.md)\n',
          mtimeMs: 1,
        },
        '/r/docs/b/moved.md': { content: '# moved', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: true, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.fixed).toBe(2)
      expect(result.broken).toEqual([])
    })
  })

  // Issue #39, scenario E: cross-hierarchy target, still inside the checkout root.
  it('resolves a real cross-hierarchy target instead of always reporting it broken, and still catches a genuinely missing one', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': {
        content: '[code](../../src/cli.ts) [ghost](../../src/ghost.ts)',
        mtimeMs: 1,
      },
      '/r/src/cli.ts': { content: 'export {}', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken[0]?.links).toEqual([{ reason: 'path', target: '../../src/ghost.ts', text: 'ghost' }])
  })

  // Issue #39, scenario F: line anchor on a cross-hierarchy non-md target.
  it('validates a GitHub-style line anchor against the real target line count', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': {
        content: '[line](../../src/cli.ts#L2) [badline](../../src/cli.ts#L100)',
        mtimeMs: 1,
      },
      '/r/src/cli.ts': { content: 'line1\nline2\nline3', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken[0]?.links).toEqual([
      { detail: 'target has 3 lines', reason: 'line', target: '../../src/cli.ts#L100', text: 'badline' },
    ])
  })

  // Issue #48 (`onlyGitTracked`): `trackedFiles`, when supplied, has to narrow
  // BOTH sides of a link — which docs get scanned as sources, AND which
  // targets count as "existing" (in-root via `known`, cross-hierarchy via the
  // `resolvePendingCheck` gate) — since an untracked target is exactly as
  // invisible to a fresh CI checkout as an untracked source doc is.
  describe('trackedFiles (onlyGitTracked)', () => {
    it('excludes an untracked source doc from scanning entirely (not reported at all, not even as broken)', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/scratch.md': { content: '[dead](./nope.md)', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({ base: '/r', fix: false, roots: ['/r/docs'], trackedFiles: new Set() }).pipe(Effect.provide(layer)),
      )
      expect(result.checked).toBe(0)
      expect(result.broken).toEqual([])
    })

    it('an untracked in-root target reports broken even though it physically exists — a tracked doc must not falsely resolve it', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/index.md': { content: '[see](../untracked.md)', mtimeMs: 1 },
        '/r/docs/untracked.md': { content: '# untracked', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({
          base: '/r',
          fix: false,
          roots: ['/r/docs'],
          trackedFiles: new Set(['/r/docs/a/index.md']),
        }).pipe(Effect.provide(layer)),
      )
      expect(result.broken[0]?.links).toEqual([{ reason: 'path', target: '../untracked.md', text: 'see' }])
    })

    it('an untracked cross-hierarchy (out-of-root) target reports broken even though it physically exists', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/index.md': { content: '[code](../../src/untracked.ts)', mtimeMs: 1 },
        '/r/src/untracked.ts': { content: 'export {}', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({
          base: '/r',
          fix: false,
          roots: ['/r/docs'],
          trackedFiles: new Set(['/r/docs/a/index.md']),
        }).pipe(Effect.provide(layer)),
      )
      expect(result.broken[0]?.links).toEqual([{ reason: 'path', target: '../../src/untracked.ts', text: 'code' }])
    })

    it('a TRACKED cross-hierarchy target still resolves normally', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/a/index.md': { content: '[code](../../src/cli.ts)', mtimeMs: 1 },
        '/r/src/cli.ts': { content: 'export {}', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkLinks({
          base: '/r',
          fix: false,
          roots: ['/r/docs'],
          trackedFiles: new Set(['/r/docs/a/index.md', '/r/src/cli.ts']),
        }).pipe(Effect.provide(layer)),
      )
      expect(result.broken).toEqual([])
    })

    it('undefined trackedFiles (the default) is byte-identical to omitting the field', async () => {
      const layer = makeTestDocsFs(seed())
      const withUndefined = await Effect.runPromise(
        checkLinks({ base: '/r', fix: false, roots: ['/r/docs'], trackedFiles: undefined }).pipe(Effect.provide(layer)),
      )
      const withoutField = await Effect.runPromise(
        checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(withUndefined.broken).toEqual(withoutField.broken)
      expect(withUndefined.checked).toBe(withoutField.checked)
    })
  })

  // Corner case (found via self-review, reproduced by construction — a real
  // crash, not a hypothetical): an anchor on a link that resolves to a
  // DIRECTORY, not a file. `exists`/`known` only prove the path resolves to
  // *something*; reading a directory's content dies (ENOENT/EISDIR), which
  // must never take the whole `checkLinks` run down over one unusual link —
  // existence already holds, so this is unverifiable, not broken.
  it('does not crash on an anchor whose target resolves to a directory, in-root', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': { content: '[see](../lib/#config)', mtimeMs: 1 },
      '/r/docs/lib/readme.md': { content: '# x', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  it('does not crash on an anchor whose target resolves to a directory, out-of-root', async () => {
    const files: Record<string, string> = {
      '/r/docs/a/index.md': '[see](../../lib/#config)',
    }
    const service: DocsFsService = {
      deleteFile: () => Effect.succeed(undefined),
      exists: (abs) => Effect.succeed(abs === '/r/lib' || abs in files),
      listFiles: () => Effect.succeed(Object.keys(files)),
      readFile: (abs) => (abs in files ? Effect.succeed(files[abs] ?? '') : Effect.die(new Error(`ENOENT: ${abs}`))),
      realPath: (abs) => Effect.succeed(abs in files ? abs : null),
      stat: () => Effect.die('not used in this test'),
      writeFile: () => Effect.succeed(undefined),
    }
    const layer = Layer.succeed(DocsFs, service)
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  // Efficiency (found via self-review, not the issue text): a plain
  // existence-only cross-hierarchy link (no `#fragment`) must never read the
  // target's content — only its existence needs proving.
  it('does not read a cross-hierarchy target file when the link carries no anchor', async () => {
    const files: Record<string, string> = {
      '/r/docs/a/index.md': '[code](../../src/cli.ts)',
      '/r/src/cli.ts': 'export {}',
    }
    let readCount = 0
    const service: DocsFsService = {
      deleteFile: () => Effect.succeed(undefined),
      exists: (abs) => Effect.succeed(abs in files),
      listFiles: () => Effect.succeed(Object.keys(files).filter((p) => p.startsWith('/r/docs'))),
      readFile: (abs) => {
        readCount += 1
        return Effect.succeed(files[abs] ?? '')
      },
      realPath: (abs) => Effect.succeed(abs in files ? abs : null),
      stat: () => Effect.die('not used in this test'),
      writeFile: () => Effect.succeed(undefined),
    }
    const layer = Layer.succeed(DocsFs, service)
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
    // Exactly one read: the source file itself. The out-of-root target's
    // existence is proven via `exists`, never `readFile`.
    expect(readCount).toBe(1)
  })

  // Issue #39, scenario G (explicit non-goal): a symbol-shaped anchor on a
  // non-md target is unverifiable — never flagged, not treated as broken.
  it('does not flag a symbol-shaped anchor on a real non-md target (out of v1 scope, not a false positive)', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a/index.md': { content: '[sym](../../src/cli.ts#someExport)', mtimeMs: 1 },
      '/r/src/cli.ts': { content: 'export const x = 1', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  // Issue #39 security requirement: a target outside the checkout root (`base`)
  // is never stat'd/read at all — the observable signal (broken) must be
  // constant regardless of what's actually there, so cairn can't be turned
  // into a filesystem-existence oracle by an untrusted PR's link target.
  it('never touches the filesystem for a target resolving outside `base`', async () => {
    const files: Record<string, string> = {
      '/r/docs/a/index.md': '[escape](../../../etc/passwd)',
    }
    let outsideBaseTouched = false
    const guard = (abs: string): void => {
      if (!abs.startsWith('/r/')) {
        outsideBaseTouched = true
      }
    }
    const service: DocsFsService = {
      deleteFile: () => Effect.succeed(undefined),
      exists: (abs) => {
        guard(abs)
        return Effect.succeed(abs in files)
      },
      listFiles: () => Effect.succeed(Object.keys(files)),
      readFile: (abs) => {
        guard(abs)
        return Effect.succeed(files[abs] ?? '')
      },
      realPath: (abs) => Effect.succeed(abs in files ? abs : null),
      stat: () => Effect.die('not used in this test'),
      writeFile: () => Effect.succeed(undefined),
    }
    const layer = Layer.succeed(DocsFs, service)
    const result = await Effect.runPromise(
      checkLinks({ base: '/r', fix: false, roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(outsideBaseTouched).toBeFalsy()
    expect(result.broken[0]?.links).toEqual([{ reason: 'path', target: '../../../etc/passwd', text: 'escape' }])
  })
})
