import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
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

  // issue #39: an anchor/line failure must never read as "(no unique target)"
  // — that hint means "the path itself has no unambiguous replacement," which
  // is misleading when the path resolves fine and only the fragment is wrong.
  it('gives an anchor-specific hint, distinct from a path-suggestion miss', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ reason: 'anchor', target: './b.md#nope', text: 't' }] }],
      checked: 1,
      fixed: 0,
    })
    expect(lines.at(-1)).toBe('    ✗ [t](./b.md#nope) (heading/anchor not found)')
  })

  it('gives a line-specific hint', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ reason: 'line', target: '../x.ts#L999', text: 't' }] }],
      checked: 1,
      fixed: 0,
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
    })
    expect(lines.at(-1)).toBe('    ✗ [t](../x.ts#L999) (line number out of range — target has 5 lines)')
  })

  it('still reports "(no unique target)" for a path failure with no suggestion', () => {
    const lines = formatLinkReport({
      broken: [{ file: 'a.md', links: [{ reason: 'path', target: './ghost.md', text: 't' }] }],
      checked: 1,
      fixed: 0,
    })
    expect(lines.at(-1)).toBe('    ✗ [t](./ghost.md) (no unique target)')
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
