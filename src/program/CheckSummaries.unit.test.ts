import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeTestDocsFs } from '../io/DocsFs.ts'
import { checkSummaries, formatSummaryReport, stampSummaries, summaryExitCode } from './CheckSummaries.ts'

const big = Array.from({ length: 40 }, (_, i) => `ligne ${i}`).join('\n')
const tf = (content: string): { content: string; mtimeMs: number } => ({ content, mtimeMs: 0 })

describe('formatSummaryReport()', () => {
  it('reports success when nothing is pending (English by default)', () => {
    expect(formatSummaryReport({ nodes: [{} as never, {} as never], todo: [] })).toEqual([
      '✅ Hierarchical summaries OK (2 summary/ies checked).',
    ])
  })

  it('localises success to French when asked', () => {
    expect(formatSummaryReport({ nodes: [{} as never], todo: [] }, { locale: 'fr' })).toEqual([
      '✅ Résumés hiérarchiques OK (1 résumé(s) vérifié(s)).',
    ])
  })

  it('includes the methodology, the configured stamp command, and the bottom-up order', () => {
    const lines = formatSummaryReport(
      {
        nodes: [],
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
})

describe('checkSummaries()', () => {
  it('plans every missing file and directory summary', async () => {
    const layer = makeTestDocsFs({ '/r/docs/a.md': tf(big) })
    const plan = await Effect.runPromise(
      checkSummaries({ roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(plan.todo.map((n) => n.path)).toEqual(['/r/docs/a.summary.md', '/r/docs/_SUMMARY.md'])
    expect(summaryExitCode(plan)).toBe(1)
  })
})

describe('stampSummaries()', () => {
  it('stamps authored summaries bottom-up so the tree becomes consistent in one pass', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('# résumé du dossier\n\nVoir [a](./a.md)'),
      '/r/docs/a.md': tf(big),
      '/r/docs/a.summary.md': tf('# résumé de a'),
    })

    const result = await Effect.runPromise(
      stampSummaries({ roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(2)
    expect(result.missing).toEqual([])

    const after = await Effect.runPromise(
      checkSummaries({ roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(after.todo).toEqual([])
    expect(summaryExitCode(after)).toBe(0)
  })

  it('reports summaries whose content has not been authored yet as missing', async () => {
    const layer = makeTestDocsFs({ '/r/docs/a.md': tf(big) })
    const result = await Effect.runPromise(
      stampSummaries({ roots: ['/r/docs'], thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(0)
    expect(result.missing.map((n) => n.path)).toEqual(['/r/docs/a.summary.md', '/r/docs/_SUMMARY.md'])
  })
})
