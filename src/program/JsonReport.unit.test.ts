import { describe, expect, it } from 'vitest'

import { buildJsonReport } from './JsonReport.ts'

describe('buildJsonReport()', () => {
  it('is 0 when both sections are clean', () => {
    const report = buildJsonReport({
      links: { broken: [], checked: 3, fixed: 0 },
      summaries: { nodes: [], orphans: [], todo: [] },
    })
    expect(report).toEqual({
      exitCode: 0,
      links: { broken: [], checked: 3, fixed: 0 },
      summaries: { nodes: [], orphans: [], todo: [] },
    })
  })

  it('is 1 when links are broken, even if summaries are clean', () => {
    const report = buildJsonReport({
      links: { broken: [{ file: '/r/a.md', links: [{ target: './gone.md', text: 'gone' }] }], checked: 1, fixed: 0 },
      summaries: { nodes: [], orphans: [], todo: [] },
    })
    expect(report.exitCode).toBe(1)
  })

  it('is 1 when summaries have orphans, even if todo is empty', () => {
    const report = buildJsonReport({
      links: null,
      summaries: { nodes: [], orphans: ['/r/docs/gone.summary.md'], todo: [] },
    })
    expect(report.exitCode).toBe(1)
  })

  it('treats a null section as clean and passes it through as null', () => {
    const report = buildJsonReport({ links: null, summaries: null })
    expect(report).toEqual({ exitCode: 0, links: null, summaries: null })
  })
})
