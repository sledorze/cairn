import { it as effectIt } from '@effect/vitest'
import { Effect } from 'effect'
import type { Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { hashContent } from '../../core/hashing.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
import {
  checkSummaries,
  explainSummaries,
  formatSummaryReport,
  migrateStamps,
  pruneOrphans,
  stampSummaries,
  summaryExitCode,
} from './CheckSummaries.ts'

const big = Array.from({ length: 40 }, (_, i) => `ligne ${i}`).join('\n')
const tf = (content: string): { content: string; mtimeMs: number } => ({ content, mtimeMs: 0 })
const base = '/r'

/** Read a file back through the same in-memory layer, for asserting content
 * was (or wasn't) mutated by a program under test. */
const readBack = (layer: Layer.Layer<DocsFs>, path: string): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const dfs = yield* DocsFs
      return yield* dfs.readFile(path)
    }).pipe(Effect.provide(layer)),
  )

describe('formatSummaryReport()', () => {
  it('reports success when nothing is pending (English by default)', () => {
    expect(formatSummaryReport({ nodes: [{} as never, {} as never], orphanStamps: [], orphans: [], todo: [] })).toEqual(
      ['✅ Hierarchical summaries OK (2 summary/ies checked).'],
    )
  })

  it('localises success to French when asked', () => {
    expect(
      formatSummaryReport({ nodes: [{} as never], orphanStamps: [], orphans: [], todo: [] }, { locale: 'fr' }),
    ).toEqual(['✅ Résumés hiérarchiques OK (1 résumé(s) vérifié(s)).'])
  })

  it('includes the methodology, the configured stamp command, and the bottom-up order', () => {
    const lines = formatSummaryReport(
      {
        nodes: [],
        orphanStamps: [],
        orphans: [],
        todo: [
          {
            expectedHash: 'x',
            inputs: [],
            kind: 'file',
            missingLinks: [],
            path: '/r/docs/sub/b.summary.md',
            recordedHash: null,
            status: 'missing',
          },
          {
            expectedHash: 'y',
            inputs: [],
            kind: 'dir',
            missingLinks: [],
            path: '/r/docs/sub/_SUMMARY.md',
            recordedHash: null,
            status: 'missing',
          },
        ],
      },
      { stampCommand: 'pnpm stamp' },
    )
    expect(lines.some((l) => l.includes('Methodology'))).toBeTruthy()
    expect(lines.some((l) => l.includes('Update order:'))).toBeTruthy()
    expect(lines.some((l) => l.includes('pnpm stamp'))).toBeTruthy()
    expect(lines.at(-2)).toContain('/r/docs/sub/b.summary.md')
    expect(lines.at(-1)).toContain('/r/docs/sub/_SUMMARY.md')
  })

  it('reports a deleted-source stamp distinctly from an orphan summary file (S3)', () => {
    const lines = formatSummaryReport({
      nodes: [],
      orphanStamps: ['/r/docs/gone.summary.md'],
      orphans: [],
      todo: [],
    })
    expect(lines.some((l) => l.includes('deleted-source stamp'))).toBeTruthy()
    expect(lines.some((l) => l.includes('/r/docs/gone.summary.md'))).toBeTruthy()
  })
})

describe('checkSummaries()', () => {
  it('plans every missing file and directory summary', async () => {
    const layer = makeTestDocsFs({ '/r/docs/a.md': tf(big) })
    const plan = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(plan.todo.map((n) => n.path)).toEqual(['/r/docs/a.summary.md', '/r/docs/_SUMMARY.md'])
    expect(summaryExitCode(plan)).toBe(1)
  })

  // Issue #48: `onlyGitTracked` (`trackedFiles`) — an untracked doc must be
  // invisible to `checkSummaries`, not just flagged differently, so a
  // directory that ONLY contains untracked docs never becomes "needs a
  // `_SUMMARY.md`" either (the issue's own `docs/scratch-notes.md` example).
  describe('trackedFiles (onlyGitTracked)', () => {
    it('excludes an untracked doc from the plan entirely — the issue #48 motivating example', async () => {
      const layer = makeTestDocsFs({ '/r/docs/scratch-notes.md': tf(big) })
      const plan = await Effect.runPromise(
        checkSummaries({
          base,
          roots: ['/r/docs'],
          thresholdLines: 30,
          trackedFiles: new Set(),
        }).pipe(Effect.provide(layer)),
      )
      expect(plan.todo).toEqual([])
      expect(summaryExitCode(plan)).toBe(0)
    })

    it('still plans a tracked doc when trackedFiles is a non-empty subset', async () => {
      const layer = makeTestDocsFs({
        '/r/docs/scratch-notes.md': tf(big),
        '/r/docs/tracked.md': tf(big),
      })
      const plan = await Effect.runPromise(
        checkSummaries({
          base,
          roots: ['/r/docs'],
          thresholdLines: 30,
          trackedFiles: new Set(['/r/docs/tracked.md']),
        }).pipe(Effect.provide(layer)),
      )
      expect(plan.todo.map((n) => n.path)).toEqual(['/r/docs/tracked.summary.md', '/r/docs/_SUMMARY.md'])
    })

    it('undefined trackedFiles (the default) is byte-identical to omitting the field entirely', async () => {
      const layer = makeTestDocsFs({ '/r/docs/a.md': tf(big) })
      const withUndefined = await Effect.runPromise(
        checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30, trackedFiles: undefined }).pipe(
          Effect.provide(layer),
        ),
      )
      const withoutField = await Effect.runPromise(
        checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
      )
      expect(withUndefined.todo).toEqual(withoutField.todo)
    })
  })

  // No test in this file's own suite ever passed `ignore` to `checkSummaries`
  // before (grep confirms it) — `CheckSummariesArgs.ignore` reaching
  // `readMarkdown`/`toPlanArgs`/`planSummaries` at all was untested from
  // this entry point, even though `SummaryTree.unit.test.ts` covers
  // `isIgnored`'s own matching logic directly. Closes that gap.
  effectIt.layer(makeTestDocsFs({ '/r/docs/SKIP.md': tf(big) }))(
    'excludes a file matched by a root-relative ignore pattern with no leading **/',
    (layerIt) => {
      layerIt.effect('excludes it', () =>
        Effect.gen(function* () {
          const plan = yield* checkSummaries({ base, ignore: ['SKIP.md'], roots: ['/r/docs'], thresholdLines: 30 })
          expect(plan.todo).toEqual([])
          expect(summaryExitCode(plan)).toBe(0)
        }),
      )
    },
  )

  it('fails with orphans even when nothing is missing/stale', async () => {
    const layer = makeTestDocsFs({ '/r/docs/gone.summary.md': tf('# stale') })
    const plan = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(plan.todo).toEqual([])
    expect(plan.orphans).toEqual(['/r/docs/gone.summary.md'])
    expect(summaryExitCode(plan)).toBe(1)
  })

  it('reads freshness from the .cairn/** sidecar, not from summary content (S1/S2)', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'), // no in-content stamp anywhere
    })
    await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    const plan = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(plan.todo).toEqual([])
    expect(summaryExitCode(plan)).toBe(0)

    // S2: editing the source alone (sidecar untouched) makes it stale again.
    await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile('/r/docs/a.md', `${big}\nmore`)
      }).pipe(Effect.provide(layer)),
    )
    const staleAgain = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(staleAgain.todo.map((n) => n.path)).toContain('/r/docs/a.summary.md')
  })

  it('reports a corrupt/merge-conflicted sidecar as a missing stamp, never a crash (R5)', async () => {
    const layer = makeTestDocsFs({
      '/r/.cairn/docs/a.summary.md.json': tf('<<<<<<< HEAD\n{"sha256":"a"}\n=======\n'),
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'),
    })
    const plan = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(plan.nodes.find((n) => n.path === '/r/docs/a.summary.md')?.status).toBe('stale')
  })

  it('S3: a deleted-source stamp sidecar is reported as an orphan stamp, independent of the summary file', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'),
    })
    await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )

    const dfs2 = makeTestDocsFs({
      '/r/.cairn/docs/_SUMMARY.md.json': tf(`{"sha256":"${'0'.repeat(64)}","version":1}`),
      '/r/.cairn/docs/a.summary.md.json': tf(`{"sha256":"${'1'.repeat(64)}","version":1}`),
      // a.md and a.summary.md both deleted — only the sidecars remain.
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
    })
    const plan = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(dfs2)),
    )
    expect(plan.orphanStamps).toContain('/r/docs/a.summary.md')
  })

  it('reads sidecars across MULTIPLE configured roots correctly (S5, at the program level)', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'),
      '/r/packages/x/docs/_SUMMARY.md': tf('Voir [b](./b.md)'),
      '/r/packages/x/docs/b.md': tf(big),
      '/r/packages/x/docs/b.summary.md': tf('# résumé de b'),
    })
    await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs', '/r/packages/x/docs'], thresholdLines: 30 }).pipe(
        Effect.provide(layer),
      ),
    )
    const plan = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs', '/r/packages/x/docs'], thresholdLines: 30 }).pipe(
        Effect.provide(layer),
      ),
    )
    expect(plan.todo).toEqual([])
    expect(summaryExitCode(plan)).toBe(0)

    // Editing only ONE root's source must not perturb the other root's freshness.
    await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile('/r/docs/a.md', `${big}\nmore`)
      }).pipe(Effect.provide(layer)),
    )
    const afterEdit = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs', '/r/packages/x/docs'], thresholdLines: 30 }).pipe(
        Effect.provide(layer),
      ),
    )
    expect(afterEdit.todo.map((n) => n.path)).toEqual(['/r/docs/a.summary.md'])
  })
})

describe('explainSummaries()', () => {
  it('shows the source outline and hash pair for a stale/missing file summary', async () => {
    const withHeadings = `${big}\n## Configuration\nmore text`
    const layer = makeTestDocsFs({ '/r/docs/a.md': tf(withHeadings) })
    const lines = await Effect.runPromise(
      explainSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    const text = lines.join('\n')
    expect(text).toContain('file /r/docs/a.summary.md (missing):')
    expect(text).toContain('expected')
    expect(text).toContain('recorded none')
    expect(text).toContain('source: /r/docs/a.md')
    expect(text).toContain('## Configuration')
  })

  it('names the stale child driving a directory summary stale', async () => {
    const layer = makeTestDocsFs({ '/r/docs/a.md': tf(big) })
    const lines = await Effect.runPromise(
      explainSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    const dirBlock = lines.join('\n')
    expect(dirBlock).toContain('dir /r/docs/_SUMMARY.md (missing):')
    expect(dirBlock).toContain('driven by stale/missing child: /r/docs/a.summary.md')
  })

  it('reports nothing to explain when everything is fresh', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'),
    })
    await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    const lines = await Effect.runPromise(
      explainSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(lines).toEqual(['Nothing to explain — all summaries are fresh.'])
  })

  it('shows the REAL recorded hash (from the sidecar), not just "none", for a genuinely stale node', async () => {
    const layer = makeTestDocsFs({
      '/r/.cairn/docs/a.summary.md.json': tf(`{"sha256":"${'0'.repeat(64)}","version":1}`),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'),
    })
    const lines = await Effect.runPromise(
      explainSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    const text = lines.join('\n')
    expect(text).toContain('file /r/docs/a.summary.md (stale):')
    // The file node's own line must show the REAL recorded hash from the sidecar,
    // not "none" — the dir node below it is separately "missing" (no _SUMMARY.md
    // authored in this fixture) and legitimately still says "recorded none".
    expect(text).toContain(`expected ${hashContent(big).slice(0, 8)}…  recorded ${'0'.repeat(8)}…`)
  })
})

describe('pruneOrphans()', () => {
  it('deletes orphan summaries and reports the count', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/a.md': tf(big),
      '/r/docs/gone.summary.md': tf('# stale'),
    })
    const removed = await Effect.runPromise(
      pruneOrphans({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(removed).toBe(1)

    const after = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(after.orphans).toEqual([])
  })

  it('also deletes an orphan .cairn/** sidecar (deleted-source stamp, S3)', async () => {
    const layer = makeTestDocsFs({
      '/r/.cairn/docs/gone.summary.md.json': tf(`{"sha256":"${'a'.repeat(64)}","version":1}`),
      '/r/docs/a.md': tf(big),
    })
    const removed = await Effect.runPromise(
      pruneOrphans({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(removed).toBe(1)
    const after = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(after.orphanStamps).toEqual([])
  })
})

describe('stampSummaries()', () => {
  it('self-heals a legacy in-content stamp without ever calling migrateStamps — no new command to discover', async () => {
    // The exact upgrade scenario: an existing repo has old in-content stamps and no
    // .cairn/** yet. The user (or CI) runs ONLY the command their existing
    // .cairnrc.json `stampCommand` already points to — plain `--stamp` — never
    // having heard of `--migrate-stamps`.
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf(`<!-- source-sha256: ${'0'.repeat(64)} -->\n\nVoir [a](./a.md)`),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf(`<!-- source-sha256: ${'1'.repeat(64)} -->\n\n# résumé de a`),
    })

    const result = await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.migrated).toBe(2)
    expect(result.stamped).toBe(2)

    const HASH_RE = /<!--\s*source-sha256:\s*[a-f0-9]{64}\s*-->/
    await expect(readBack(layer, '/r/docs/_SUMMARY.md')).resolves.not.toMatch(HASH_RE)
    await expect(readBack(layer, '/r/docs/a.summary.md')).resolves.not.toMatch(HASH_RE)

    const after = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(after.todo).toEqual([])
    expect(summaryExitCode(after)).toBe(0)
  })

  it('never strips the legacy pattern from a SOURCE doc — only from files classified as summaries', async () => {
    // A source doc's own prose can legitimately contain the literal
    // `<!-- source-sha256: <64hex> -->` text (e.g. a doc documenting cairn's own
    // former stamp format, with a real-looking example). stampFiles must treat
    // that as ordinary content, never as tool metadata to strip — a real bug
    // found by adversarial review: the strip loop originally ran over EVERY
    // markdown file `readMarkdown` returned, not just files classified as
    // summaries, so a source doc containing this exact text got silently
    // mutated by an ordinary `--stamp` run.
    const sourceDocWithLegitimateExample = `${big}\n\n## Example\n\n<!-- source-sha256: ${'a'.repeat(64)} -->\n\nThis is what the OLD stamp looked like, for historical reference.\n`
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
      '/r/docs/a.md': tf(sourceDocWithLegitimateExample),
      '/r/docs/a.summary.md': tf('# résumé de a'),
    })

    const result = await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.migrated).toBe(0) // no SUMMARY file had a legacy stamp to strip

    await expect(readBack(layer, '/r/docs/a.md')).resolves.toBe(sourceDocWithLegitimateExample)
  })

  it('stamps authored summaries bottom-up, writing sidecars and leaving content byte-identical (S1)', async () => {
    const summaryContent = '# résumé du dossier\n\nVoir [a](./a.md)'
    const fileSummaryContent = '# résumé de a'
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf(summaryContent),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf(fileSummaryContent),
    })

    const result = await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(2)
    expect(result.missing).toEqual([])

    // Content is untouched — the tracking system leaves zero bytes in tracked files.
    await expect(readBack(layer, '/r/docs/_SUMMARY.md')).resolves.toBe(summaryContent)
    await expect(readBack(layer, '/r/docs/a.summary.md')).resolves.toBe(fileSummaryContent)

    const after = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(after.todo).toEqual([])
    expect(summaryExitCode(after)).toBe(0)
  })

  it('reports summaries whose content has not been authored yet as missing', async () => {
    const layer = makeTestDocsFs({ '/r/docs/a.md': tf(big) })
    const result = await Effect.runPromise(
      stampSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(0)
    expect(result.missing.map((n) => n.path)).toEqual(['/r/docs/a.summary.md', '/r/docs/_SUMMARY.md'])
  })
})

describe('migrateStamps() (S7)', () => {
  it('strips every legacy in-content stamp, then stamps the sidecar tree, converging to green', async () => {
    const HASH_RE = /<!--\s*source-sha256:\s*[a-f0-9]{64}\s*-->/
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf(`<!-- source-sha256: ${'0'.repeat(64)} -->\n\nVoir [a](./a.md)`),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf(`<!-- source-sha256: ${'1'.repeat(64)} -->\n\n# résumé de a`),
    })

    const result = await Effect.runPromise(
      migrateStamps({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.migrated).toBe(2)
    expect(result.stamped).toBe(2)

    const dirAfter = await readBack(layer, '/r/docs/_SUMMARY.md')
    const fileAfter = await readBack(layer, '/r/docs/a.summary.md')
    expect(dirAfter).not.toMatch(HASH_RE)
    expect(fileAfter).not.toMatch(HASH_RE)
    expect(dirAfter).toBe('Voir [a](./a.md)')
    expect(fileAfter).toBe('# résumé de a')

    const after = await Effect.runPromise(
      checkSummaries({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(after.todo).toEqual([])
    expect(summaryExitCode(after)).toBe(0)
  })

  it('is idempotent: a repo with no legacy stamps just runs the ordinary stamp pass', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('Voir [a](./a.md)'),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'),
    })
    const result = await Effect.runPromise(
      migrateStamps({ base, roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.migrated).toBe(0)
    expect(result.stamped).toBe(2)
  })
})
