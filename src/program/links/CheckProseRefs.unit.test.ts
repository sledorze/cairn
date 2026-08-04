import { it as effectIt } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkProseRefs, formatProseRefsReport, proseRefsExitCode } from './CheckProseRefs.ts'

describe('checkProseRefs()', () => {
  // Issue #47 criterion 1, load-bearing: a citation that resolves is ALWAYS
  // silent — never reported, regardless of how many candidates exist.
  it('is silent for a bare citation whose target exists — never reported, even as a note', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': { content: 'See `src/services/auth.ts` for the real implementation.', mtimeMs: 1 },
      '/r/src/services/auth.ts': { content: 'export {}', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
    expect(proseRefsExitCode(result)).toBe(0)
  })

  // Issue #47 criterion 2: a moved/deleted target IS reported. `/r/src/other.ts`
  // seeds `src/` as a real top-level entry — the false-positive-sweep fix
  // requires a candidate's first segment to resolve to something real
  // (otherwise it's silently skipped, see the dedicated test below), so an
  // empty `/r/src` would make this a false negative, not a true positive.
  it('reports a bare citation whose target no longer exists, with an invitation to link', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': { content: 'See `src/services/gone.ts` for the implementation.', mtimeMs: 1 },
      '/r/src/other.ts': { content: 'export {}', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([
      {
        file: '/r/docs/guide.md',
        refs: [
          {
            reason: 'missing',
            suggestion: '[`src/services/gone.ts`](../src/services/gone.ts)',
            text: 'src/services/gone.ts',
          },
        ],
      },
    ])
    expect(proseRefsExitCode(result)).toBe(1)
  })

  // REX feedback: a doc documenting a path FORMAT — a table of sample
  // paths, a prose example using a fictitious filename — has real, path-
  // shaped, never-real backticked text with no way to distinguish it from a
  // genuine citation short of a config-level exemption. `ignoreRefs` (wired
  // from `checks.proseRefs.ignore`) is that exemption, matched against the
  // exact cited text, checked BEFORE existence — same effect as if the
  // target had resolved: silently skipped, not reported.
  effectIt.effect('ignoreRefs silently exempts an exact illustrative citation that would otherwise be reported', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/guide.md': { content: '| `src/a.ts` | silent |\n| `src/a.js` | warns |\n', mtimeMs: 1 },
        '/r/src/other.ts': { content: 'export {}', mtimeMs: 1 },
      })
      const result = yield* checkProseRefs({
        base: '/r',
        ignoreRefs: ['src/a.ts', 'src/a.js'],
        roots: ['/r/docs'],
      }).pipe(Effect.provide(layer))
      expect(result.broken).toEqual([])
      expect(proseRefsExitCode(result)).toBe(0)
    }),
  )

  effectIt.effect('ignoreRefs supports a glob, and only exempts what it matches — a real citation still reports', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/guide.md': {
          content: 'Example: `examples/*.ts`. Also see `src/services/gone.ts`.',
          mtimeMs: 1,
        },
        '/r/src/other.ts': { content: 'export {}', mtimeMs: 1 },
      })
      const result = yield* checkProseRefs({ base: '/r', ignoreRefs: ['examples/*'], roots: ['/r/docs'] }).pipe(
        Effect.provide(layer),
      )
      expect(result.broken).toEqual([
        {
          file: '/r/docs/guide.md',
          refs: [
            {
              reason: 'missing',
              suggestion: '[`src/services/gone.ts`](../src/services/gone.ts)',
              text: 'src/services/gone.ts',
            },
          ],
        },
      ])
    }),
  )

  // Issue #47 criterion 3 / security: a candidate resolving OUTSIDE `base`
  // is never `dfs.exists`'d — reported as unverifiable regardless of what's
  // actually on disk there, the same #39/#40 discipline.
  it('reports a traversal-shaped citation as unverifiable, never calling dfs.exists at all', async () => {
    let existsCalled = false
    const files: Record<string, string> = { '/r/docs/guide.md': 'See `x/../../../../etc/passwd` for details.' }
    const service: DocsFsService = {
      deleteFile: () => Effect.succeed(undefined),
      exists: (abs) => {
        existsCalled = true
        return Effect.succeed(abs in files)
      },
      listFiles: () => Effect.succeed(Object.keys(files)),
      readFile: (abs) => Effect.succeed(files[abs] ?? ''),
      realPath: (abs) => Effect.succeed(abs in files ? abs : null),
      stat: () => Effect.succeed({ mtimeMs: 0, sizeBytes: 0 }),
      writeFile: () => Effect.succeed(undefined),
    }
    const layer = Layer.succeed(DocsFs, service)
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken[0]?.refs).toEqual([
      {
        reason: 'unverifiable',
        suggestion: '[`x/../../../../etc/passwd`](../../etc/passwd)',
        text: 'x/../../../../etc/passwd',
      },
    ])
    // The real assertion: existence is never even CONSULTED for an
    // out-of-base target — `isWithinBase` rejects it first, exactly #39/#40's
    // discipline, applied here to a citation that needed no `[]()` syntax.
    expect(existsCalled).toBeFalsy()
  })

  it('does not flag package.json/.env/plain-word citations at all (never candidates)', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': {
        content: 'Edit `package.json` and `.env`. Also `justAWord` and run `npm install`.',
        mtimeMs: 1,
      },
    })
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  // Found via the real false-positive sweep against this repo's own docs/.
  it('does not flag a bare directory/module mention like `core/` (no filename to check)', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': { content: 'See the `core/` module for details.', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  // Found via the same sweep: `../sidecar.ts`-style relative addressing is a
  // different convention than a "rooted" repo path and is never a candidate,
  // regardless of whether it happens to resolve inside or outside `base`.
  it('does not flag a `../`-relative citation — only ROOTED paths are candidates', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': { content: 'See `../sidecar.ts` for the shared mechanics.', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  // A candidate whose first segment doesn't resolve to anything real under
  // `base` at all (e.g. an npm package-import-style string like
  // `effect/Schema`) is silently skipped, not reported — same sweep finding.
  it('silently skips a candidate whose first path segment does not exist under base at all', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': { content: 'Uses `effect/Schema` under the hood.', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  it('ignores a path-like citation inside a fenced code example', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': {
        content: ['See `src/a.ts`.', '', '```', '`src/fenced-gone.ts`', '```'].join('\n'),
        mtimeMs: 1,
      },
      '/r/src/a.ts': { content: 'export {}', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkProseRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.broken).toEqual([])
  })

  it('formatProseRefsReport reports success when nothing is broken', () => {
    const lines = formatProseRefsReport({ broken: [], checked: 3 })
    expect(lines).toEqual(['✅ No broken prose file-references found (3 file(s) checked).'])
  })

  it('formatProseRefsReport names the invitation-to-link suggestion in its output', () => {
    const lines = formatProseRefsReport({
      broken: [
        {
          file: 'docs/guide.md',
          refs: [{ reason: 'missing', suggestion: '[`src/x.ts`](../src/x.ts)', text: 'src/x.ts' }],
        },
      ],
      checked: 1,
    })
    expect(lines.at(-1)).toBe('    ✗ `src/x.ts` (does not resolve) → consider a link: [`src/x.ts`](../src/x.ts)')
  })

  // Found via dimension-coverage review: checkLinks/checkSummaries both wire
  // `ignore`/`trackedFiles` through explicitly; checkProseRefs had neither,
  // silently inconsistent with every sibling check.
  describe('ignore/trackedFiles composition (found via dimension-coverage review)', () => {
    it('respects `ignore` — an excluded doc is never scanned for prose citations', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/vendor/CHANGELOG.md': { content: 'See `src/gone.ts` for details.', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkProseRefs({ base: '/r', ignore: ['**/vendor/**'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.broken).toEqual([])
      expect(result.checked).toBe(0)
    })

    // Issue #102: a root-relative pattern with no leading `**/` (the form
    // anyone actually writes) must exclude a doc just as reliably as the
    // `**`-prefixed pattern above — regression coverage exercised through
    // the real checker, not just `isIgnored`'s own unit tests.
    it('respects a root-relative `ignore` pattern with no leading **/ (issue #102)', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/SKIP.md': { content: 'See `src/gone.ts` for details.', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkProseRefs({ base: '/r', ignore: ['SKIP.md'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
      )
      expect(result.broken).toEqual([])
      expect(result.checked).toBe(0)
    })

    it('respects `trackedFiles` — an untracked doc is never scanned', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/scratch.md': { content: 'See `src/gone.ts` for details.', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkProseRefs({ base: '/r', roots: ['/r/docs'], trackedFiles: new Set() }).pipe(Effect.provide(layer)),
      )
      expect(result.broken).toEqual([])
      expect(result.checked).toBe(0)
    })

    it('an untracked TARGET reports missing even though it physically exists — CI parity for prose citations too', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/guide.md': { content: 'See `src/untracked.ts` for details.', mtimeMs: 1 },
        '/r/src/untracked.ts': { content: 'export {}', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkProseRefs({
          base: '/r',
          roots: ['/r/docs'],
          trackedFiles: new Set(['/r/docs/guide.md']),
        }).pipe(Effect.provide(layer)),
      )
      expect(result.broken[0]?.refs.map((r) => r.text)).toEqual(['src/untracked.ts'])
    })

    it('a TRACKED target still resolves normally', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/guide.md': { content: 'See `src/tracked.ts` for details.', mtimeMs: 1 },
        '/r/src/tracked.ts': { content: 'export {}', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkProseRefs({
          base: '/r',
          roots: ['/r/docs'],
          trackedFiles: new Set(['/r/docs/guide.md', '/r/src/tracked.ts']),
        }).pipe(Effect.provide(layer)),
      )
      expect(result.broken).toEqual([])
    })
  })
})
