import { describe, expect, it } from 'vitest'

import { hashContent, sourceHashTag } from './DocSummaries.ts'
import type { Naming } from './DocSummaries.ts'
import { planSummaries } from './SummaryTree.ts'

const big = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n')

describe('planSummaries() link-completeness ignores code blocks', () => {
  it('does not count a child link that only appears inside a code fence', () => {
    const files = new Map<string, string>([
      ['/r/docs/a.md', big],
      ['/r/docs/a.summary.md', `${sourceHashTag(hashContent(big))}\n\n# s`],
    ])
    const expectedHash = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 }).nodes.find(
      (n) => n.path === '/r/docs/_SUMMARY.md',
    )?.expectedHash
    const stamp = sourceHashTag(expectedHash ?? '')
    // The only mention of the child is inside a fenced code block.
    files.set('/r/docs/_SUMMARY.md', `${stamp}\n\n\`\`\`md\n[a](./a.md)\n\`\`\`\n`)
    const node = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 }).nodes.find(
      (n) => n.path === '/r/docs/_SUMMARY.md',
    )
    expect(node?.status).toBe('stale')
    expect(node?.missingLinks).toEqual(['/r/docs/a.md'])
  })
})

describe('planSummaries() with custom naming', () => {
  const naming: Naming = { dirSummary: 'INDEX.md', fileSummarySuffix: '.digest.md' }
  const files = new Map<string, string>([['/r/docs/a.md', big]])
  const plan = planSummaries({ files, naming, roots: ['/r/docs'], thresholdLines: 30 })
  const paths = plan.nodes.map((n) => n.path)

  it('derives the file summary from the configured suffix', () => {
    expect(paths).toContain('/r/docs/a.digest.md')
    expect(paths).not.toContain('/r/docs/a.summary.md')
  })

  it('derives the directory summary from the configured name', () => {
    expect(paths).toContain('/r/docs/INDEX.md')
    expect(paths).not.toContain('/r/docs/_SUMMARY.md')
  })
})

describe('planSummaries() with ignore globs', () => {
  it('does not require a summary for an ignored file', () => {
    const files = new Map<string, string>([
      ['/r/docs/a.md', big],
      ['/r/docs/CHANGELOG.md', big],
    ])
    const plan = planSummaries({
      files,
      ignore: ['**/CHANGELOG.md'],
      roots: ['/r/docs'],
      thresholdLines: 30,
    })
    const paths = plan.nodes.map((n) => n.path)
    expect(paths).toContain('/r/docs/a.summary.md')
    expect(paths).not.toContain('/r/docs/CHANGELOG.summary.md')
  })
})

describe('planSummaries() with requireDirSummaries: false', () => {
  it('plans only file summaries, no directory summaries', () => {
    const files = new Map<string, string>([['/r/docs/sub/a.md', big]])
    const plan = planSummaries({
      files,
      requireDirSummaries: false,
      roots: ['/r/docs'],
      thresholdLines: 30,
    })
    expect(plan.nodes.every((n) => n.kind === 'file')).toBeTruthy()
    expect(plan.nodes.map((n) => n.path)).toEqual(['/r/docs/sub/a.summary.md'])
  })

  it('does not flag a leftover _SUMMARY.md as an orphan when dir summaries are not required', () => {
    const files = new Map<string, string>([
      ['/r/docs/sub/a.md', big],
      ['/r/docs/sub/_SUMMARY.md', '# stale index'],
    ])
    const plan = planSummaries({
      files,
      requireDirSummaries: false,
      roots: ['/r/docs'],
      thresholdLines: 30,
    })
    expect(plan.orphans).toEqual([])
  })
})

describe('planSummaries() orphan detection', () => {
  it('flags a file summary whose source doc was deleted or renamed', () => {
    const files = new Map<string, string>([['/r/docs/gone.summary.md', '# stale']])
    const plan = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 })
    expect(plan.orphans).toEqual(['/r/docs/gone.summary.md'])
  })

  it('flags a directory summary whose directory no longer has any docs', () => {
    const files = new Map<string, string>([['/r/docs/sub/_SUMMARY.md', '# stale index']])
    const plan = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 })
    expect(plan.orphans).toEqual(['/r/docs/sub/_SUMMARY.md'])
  })

  it('flags a summary whose source dropped below the line threshold', () => {
    const small = 'one line'
    const files = new Map<string, string>([
      ['/r/docs/a.md', small],
      ['/r/docs/a.summary.md', '# now orphaned'],
    ])
    const plan = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 })
    expect(plan.orphans).toContain('/r/docs/a.summary.md')
  })

  it('does not flag an orphan matching an ignore glob', () => {
    const files = new Map<string, string>([['/r/docs/CHANGELOG.summary.md', '# stale']])
    const plan = planSummaries({ files, ignore: ['**/CHANGELOG.summary.md'], roots: ['/r/docs'], thresholdLines: 30 })
    expect(plan.orphans).toEqual([])
  })

  it('respects custom naming when detecting orphans', () => {
    const naming: Naming = { dirSummary: 'INDEX.md', fileSummarySuffix: '.digest.md' }
    const files = new Map<string, string>([['/r/docs/gone.digest.md', '# stale']])
    const plan = planSummaries({ files, naming, roots: ['/r/docs'], thresholdLines: 30 })
    expect(plan.orphans).toEqual(['/r/docs/gone.digest.md'])
  })

  it('does not flag a fresh, expected summary as an orphan', () => {
    const files = new Map<string, string>([['/r/docs/a.md', big]])
    const plan = planSummaries({ files, roots: ['/r/docs'], thresholdLines: 30 })
    expect(plan.orphans).toEqual([])
  })
})
