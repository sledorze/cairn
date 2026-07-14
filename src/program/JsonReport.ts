// `--json`: a single combined, machine-readable result for `cairn check`.
// Wraps the already-structured `SummaryPlan`/`LinkCheckResult` — no new
// computation, just packaging + the same exit-code rules as the text report.

import type { SummaryPlan } from '../core/SummaryTree.ts'
import type { LinkCheckResult } from './CheckLinks.ts'
import { linkExitCode } from './CheckLinks.ts'
import { summaryExitCode } from './CheckSummaries.ts'

export interface JsonReport {
  readonly exitCode: number
  readonly links: LinkCheckResult | null
  readonly summaries: SummaryPlan | null
}

export interface JsonReportArgs {
  readonly links: LinkCheckResult | null
  readonly summaries: SummaryPlan | null
}

/** `summaries`/`links` are `null` when that check was skipped (`--links-only`/`--summaries-only`). */
export const buildJsonReport = ({ links, summaries }: JsonReportArgs): JsonReport => {
  const summaryCode = summaries === null ? 0 : summaryExitCode(summaries)
  const linkCode = links === null ? 0 : linkExitCode(links)
  return { exitCode: Math.max(summaryCode, linkCode), links, summaries }
}
