// Effect programs for the hierarchical summary system.
//  - `checkSummaries`  -> the plan (what is missing/stale, bottom-up order).
//  - `stampSummaries`  -> (re)writes the source-hash stamp of EXISTING summaries
//     bottom-up, so a parent's manifest sees its freshly-stamped children.
// Pure planning lives in ../core/SummaryTree.ts; freshness primitives in
// ../core/DocSummaries.ts.

import { Effect } from 'effect'

import { DEFAULT_STAMP_COMMAND } from '../core/Config.ts'
import type { Naming } from '../core/DocSummaries.ts'
import { countLines, withSourceHash } from '../core/DocSummaries.ts'
import type { PlanArgs, PlanNode, SummaryPlan } from '../core/SummaryTree.ts'
import { planSummaries } from '../core/SummaryTree.ts'
import { DocsFs } from '../io/DocsFs.ts'
import type { Locale } from './locale.ts'
import { enOnly, pick } from './locale.ts'

export { DEFAULT_STAMP_COMMAND } from '../core/Config.ts'

export interface CheckSummariesArgs {
  readonly ignore?: readonly string[]
  readonly naming?: Naming
  readonly requireDirSummaries?: boolean
  readonly roots: readonly string[]
  readonly thresholdLines?: number
}

export interface SummaryReportOptions {
  readonly locale?: Locale
  readonly stampCommand?: string
}

export interface StampResult {
  readonly missing: readonly PlanNode[]
  readonly stamped: number
}

/** Assemble the pure planner's arguments from the program args + file map. */
const toPlanArgs = (files: ReadonlyMap<string, string>, args: CheckSummariesArgs): PlanArgs => ({
  files,
  ...(args.ignore === undefined ? {} : { ignore: args.ignore }),
  ...(args.naming === undefined ? {} : { naming: args.naming }),
  ...(args.requireDirSummaries === undefined ? {} : { requireDirSummaries: args.requireDirSummaries }),
  roots: args.roots,
  ...(args.thresholdLines === undefined ? {} : { thresholdLines: args.thresholdLines }),
})

const readMarkdown = (roots: readonly string[]): Effect.Effect<Map<string, string>, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const all = yield* dfs.listFiles(roots)
    const files = new Map<string, string>()
    for (const file of all) {
      if (file.endsWith('.md')) {
        files.set(file, yield* dfs.readFile(file))
      }
    }
    return files
  })

/** 0 when nothing is missing/stale and no orphans remain, 1 otherwise. */
export const summaryExitCode = (plan: SummaryPlan): number => (plan.todo.length > 0 || plan.orphans.length > 0 ? 1 : 0)

/** Report lines: methodology + the bottom-up update order, for a one-pass fix. */
export const formatSummaryReport = (plan: SummaryPlan, options: SummaryReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const stampCommand = options.stampCommand ?? DEFAULT_STAMP_COMMAND
  if (plan.todo.length === 0 && plan.orphans.length === 0) {
    return [
      pick(locale, {
        en: `✅ Hierarchical summaries OK (${plan.nodes.length} summary/ies checked).`,
        fr: `✅ Résumés hiérarchiques OK (${plan.nodes.length} résumé(s) vérifié(s)).`,
      }),
    ]
  }
  const orphanLines = plan.orphans.map((p) =>
    pick(locale, {
      en: `  ✗ orphan summary (source gone): ${p}`,
      fr: `  ✗ résumé orphelin (source disparue) : ${p}`,
    }),
  )
  if (plan.todo.length === 0) {
    return [
      pick(locale, {
        en: `❌ ${plan.orphans.length} orphan summary/ies (source doc deleted, renamed, or below threshold):`,
        fr: `❌ ${plan.orphans.length} résumé(s) orphelin(s) (source supprimée, renommée, ou sous le seuil) :`,
      }),
      ...orphanLines,
    ]
  }
  const lines = pick(locale, {
    en: [
      `❌ ${plan.todo.length} summary/ies to (re)generate.`,
      '',
      'Methodology (a single, bottom-up pass):',
      '  1. File summaries: one per doc over the line threshold, a fast-to-read version of the source.',
      '  2. Directory summaries (_SUMMARY.md): aggregate the summaries of direct docs (or the doc itself when short) + the _SUMMARY.md of direct sub-directories.',
      `  3. Process in THIS order (files, then deepest directories), then run \`${stampCommand}\` to stamp the hashes.`,
      '',
      'Update order:',
    ],
    fr: [
      `❌ ${plan.todo.length} résumé(s) à (re)générer.`,
      '',
      'Méthodologie (une seule passe, de bas en haut) :',
      '  1. Résumés de fichier : 1 par doc au-dessus du seuil de lignes, version rapide à lire de la source.',
      "  2. Résumés de répertoire (_SUMMARY.md) : agrègent les résumés des docs directs (ou le doc s'il est court) + les _SUMMARY.md des sous-répertoires directs.",
      `  3. Traiter dans CET ordre (fichiers puis répertoires les plus profonds), puis lancer \`${stampCommand}\` pour tamponner les hash.`,
      '',
      'Ordre de mise à jour :',
    ],
  })
  for (const node of plan.todo) {
    const tag =
      node.kind === 'dir'
        ? pick(locale, { en: 'directory', fr: 'répertoire' })
        : pick(locale, { en: 'file', fr: 'fichier' })
    let reason =
      node.status === 'missing'
        ? pick(locale, { en: 'missing', fr: 'manquant' })
        : pick(locale, { en: 'stale (source changed)', fr: 'périmé (source modifiée)' })
    if (node.missingLinks.length > 0) {
      reason = pick(locale, {
        en: `missing child links (${node.missingLinks.length})`,
        fr: `liens enfants manquants (${node.missingLinks.length})`,
      })
    }
    lines.push(`  - [${tag}] ${node.path} : ${reason}`)
  }
  if (plan.orphans.length > 0) {
    lines.push(
      '',
      pick(locale, {
        en: `${plan.orphans.length} orphan summary/ies (source doc deleted, renamed, or below threshold):`,
        fr: `${plan.orphans.length} résumé(s) orphelin(s) (source supprimée, renommée, ou sous le seuil) :`,
      }),
      ...orphanLines,
    )
  }
  return lines
}

const shortHash = (h: string | null): string => (h === null ? 'none' : `${h.slice(0, 8)}…`)

/** Markdown headings in `content`, in order, for a quick outline of what changed. */
const headings = (content: string): string[] =>
  content
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.trim())

/**
 * Explain why each `todo` node is not ok. cairn stores only a content hash, not
 * prior source text, so this cannot diff against the previously-summarized
 * version — it surfaces what IS derivable: the expected/recorded hash pair, the
 * changed source's current outline (file summaries), or which stale/missing
 * child is driving a directory summary stale (dir summaries).
 */
const explainPlan = (
  plan: SummaryPlan,
  files: ReadonlyMap<string, string>,
  options: SummaryReportOptions,
): string[] => {
  const locale = options.locale ?? 'en'
  if (plan.todo.length === 0) {
    return [pick(locale, enOnly('Nothing to explain — all summaries are fresh.'))]
  }
  const byPath = new Map(plan.nodes.map((n) => [n.path, n]))
  const lines: string[] = []
  for (const node of plan.todo) {
    lines.push(
      `${node.kind} ${node.path} (${node.status}):`,
      `  expected ${shortHash(node.expectedHash)}  recorded ${shortHash(node.recordedHash)}`,
    )
    if (node.kind === 'file') {
      const source = node.inputs[0]
      const content = source === undefined ? '' : (files.get(source) ?? '')
      lines.push(`  source: ${source} (${countLines(content)} lines)`, ...headings(content).map((h) => `    ${h}`))
    } else {
      const staleInputs = node.inputs.filter((input) => byPath.get(input)?.status !== 'ok')
      if (staleInputs.length > 0) {
        lines.push(`  driven by stale/missing child: ${staleInputs.join(', ')}`)
      }
      if (node.missingLinks.length > 0) {
        lines.push(`  missing links to: ${node.missingLinks.join(', ')}`)
      }
    }
    lines.push('')
  }
  return lines
}

export const checkSummaries = (args: CheckSummariesArgs): Effect.Effect<SummaryPlan, never, DocsFs> =>
  Effect.gen(function* () {
    const files = yield* readMarkdown(args.roots)
    return planSummaries(toPlanArgs(files, args))
  })

/** `--explain`: why each todo node is not ok (see `explainPlan` for what this can and cannot show). */
export const explainSummaries = (
  args: CheckSummariesArgs,
  options: SummaryReportOptions = {},
): Effect.Effect<string[], never, DocsFs> =>
  Effect.gen(function* () {
    const files = yield* readMarkdown(args.roots)
    const plan = planSummaries(toPlanArgs(files, args))
    return explainPlan(plan, files, options)
  })

/**
 * Stamp every EXISTING summary with its current source/manifest hash, bottom-up,
 * recomputing the plan after each write so parents see freshly-stamped children.
 * Summaries whose content has not been authored yet are returned as `missing`.
 */
export const stampSummaries = (args: CheckSummariesArgs): Effect.Effect<StampResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const files = yield* readMarkdown(args.roots)
    const order = planSummaries(toPlanArgs(files, args)).nodes

    const missing: PlanNode[] = []
    let stamped = 0
    for (const node of order) {
      if (!files.has(node.path)) {
        missing.push(node)
        continue
      }
      // Recompute against current (already-stamped children) state.
      const fresh = planSummaries(toPlanArgs(files, args))
      const current = fresh.nodes.find((n) => n.path === node.path)
      if (!current) {
        continue
      }
      const stampedContent = withSourceHash(files.get(node.path) ?? '', current.expectedHash)
      files.set(node.path, stampedContent)
      yield* dfs.writeFile(node.path, stampedContent)
      stamped += 1
    }
    return { missing, stamped }
  })

/** Delete every orphan summary (source doc gone) and report how many were removed. */
export const pruneOrphans = (args: CheckSummariesArgs): Effect.Effect<number, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const files = yield* readMarkdown(args.roots)
    const plan = planSummaries(toPlanArgs(files, args))
    for (const orphan of plan.orphans) {
      yield* dfs.deleteFile(orphan)
    }
    return plan.orphans.length
  })

// Re-exported so callers can recognise summary files without importing two modules.
export { isSummaryFile } from '../core/DocSummaries.ts'
export { isDirSummary } from '../core/SummaryTree.ts'
