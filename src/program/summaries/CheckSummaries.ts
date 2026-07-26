// Effect programs for the hierarchical summary system.
//  - `checkSummaries`   -> the plan (what is missing/stale, bottom-up order).
//  - `stampSummaries`   -> (re)writes the freshness stamp of EXISTING summaries,
//     bottom-up, into their `.cairn/**` sidecar (never into the summary's own
//     content — see StampStore.ts).
//  - `migrateStamps`    -> one-off: strips the legacy in-content stamp from
//     every summary, then runs the sidecar stamp pass over the stripped tree.
// Pure planning lives in ../../core/summaries/SummaryTree.ts; freshness
// primitives in ../../core/summaries/DocSummaries.ts; sidecar path mapping +
// (de)serialisation in ../../core/summaries/StampStore.ts.

import { Effect } from 'effect'

import { DEFAULT_STAMP_COMMAND } from '../../core/Config.ts'
import type { Naming } from '../../core/summaries/DocSummaries.ts'
import { countLines, isSummaryFile, stripSourceHash } from '../../core/summaries/DocSummaries.ts'
import { parseStamp, serializeStamp, STAMP_VERSION } from '../../core/summaries/StampStore.ts'
import type { PlanArgs, PlanNode, SummaryPlan } from '../../core/summaries/SummaryTree.ts'
import { isDirSummary, nodeExpectedHash, planSummaries } from '../../core/summaries/SummaryTree.ts'
import type { MetaLayout } from '../../core/sidecar.ts'
import { metaRootFor, nodePathForSidecar, sidecarPathFor } from '../../core/sidecar.ts'
import { DocsFs } from '../../io/DocsFs.ts'
import type { Locale } from '../locale.ts'
import { enOnly, pick } from '../locale.ts'

export { DEFAULT_STAMP_COMMAND } from '../../core/Config.ts'

export interface CheckSummariesArgs {
  /** Project root every root/node path and every `.cairn/**` sidecar is
   * resolved under (see StampStore.ts's `MetaLayout`). Real usage: `process.cwd()`. */
  readonly base: string
  readonly ignore?: readonly string[]
  readonly naming?: Naming
  readonly requireDirSummaries?: boolean
  readonly roots: readonly string[]
  readonly thresholdLines?: number
  /** Issue #48 (`onlyGitTracked`): when supplied, `readMarkdown` only considers
   * files in this set — absolute POSIX paths, as `GitFs.listTrackedFiles`
   * returns them. `undefined` (the default) preserves today's behavior
   * byte-for-byte: every file the glob/roots scan finds is in scope,
   * regardless of git state. */
  readonly trackedFiles?: ReadonlySet<string> | undefined
}

export interface SummaryReportOptions {
  readonly locale?: Locale
  readonly stampCommand?: string
}

export interface StampResult {
  /** Legacy in-content `<!-- source-sha256 -->` stamps stripped along the way —
   * an ordinary `--stamp` run (the one every existing `.cairnrc.json`'s
   * `stampCommand` already points to) self-heals a repo upgrading off the old
   * scheme with ZERO new command to discover; this count is only surfaced so
   * that self-healing is visible, not silent-and-unverifiable. */
  readonly migrated: number
  readonly missing: readonly PlanNode[]
  readonly stamped: number
}

/** Alias kept for the explicit, nameable one-shot migration entry point
 * (`--migrate-stamps`) — identical shape to `StampResult` now that stripping
 * is unconditional in `stampFiles`, but naming it distinctly documents intent
 * at the call site (`cli.ts`) and in reports. */
export type MigrateResult = StampResult

const EMPTY_STAMPS: ReadonlyMap<string, string> = new Map()

const layoutFor = (base: string): MetaLayout => ({ base, metaRoot: metaRootFor(base) })

/** Assemble the pure planner's arguments from the program args + file map.
 * `stamps` defaults to empty — callers that don't need freshness status (the
 * stamp-writing pass itself) can omit it entirely and skip loading it. */
const toPlanArgs = (
  files: ReadonlyMap<string, string>,
  args: CheckSummariesArgs,
  stamps: ReadonlyMap<string, string> = EMPTY_STAMPS,
): PlanArgs => ({
  files,
  ...(args.ignore === undefined ? {} : { ignore: args.ignore }),
  ...(args.naming === undefined ? {} : { naming: args.naming }),
  ...(args.requireDirSummaries === undefined ? {} : { requireDirSummaries: args.requireDirSummaries }),
  roots: args.roots,
  stamps,
  ...(args.thresholdLines === undefined ? {} : { thresholdLines: args.thresholdLines }),
})

const readMarkdown = (
  roots: readonly string[],
  trackedFiles?: ReadonlySet<string>,
): Effect.Effect<Map<string, string>, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const all = yield* dfs.listFiles(roots)
    const files = new Map<string, string>()
    for (const file of all) {
      // Issue #48: an untracked doc is invisible to a fresh CI checkout, so a
      // local run with `onlyGitTracked` on must be too — restricting the file
      // set BEFORE reading (not filtering the plan afterward) means an
      // untracked-only directory also never becomes "in scope, needs a
      // `_SUMMARY.md`" in the first place.
      if (file.endsWith('.md') && (trackedFiles === undefined || trackedFiles.has(file))) {
        // Found via adversarial "no unhandled exception" review: a doc that
        // successfully LISTS but can't actually be READ (permission denied,
        // revoked between listing and reading) must not crash the whole run
        // — `dfs.readFile` is `Effect.orDie`-wrapped, so this reaches the
        // DEFECT channel. Skipped exactly like an untracked/ignored file
        // already is — the pure planner then reasonably reads it as "not
        // present" rather than the whole `cairn check` dying over one
        // unreadable doc. (Narrower than `CheckLinks.ts`'s own fix for the
        // identical failure mode, which additionally surfaces a distinct,
        // exit-code-affecting `unreadable` report — deliberately not
        // replicated here, since `SummaryPlan`'s shape is pure/IO-agnostic
        // by design and widely consumed; named as a real, scoped-out
        // follow-up rather than silently matched in richness.)
        const content = yield* dfs.readFile(file).pipe(Effect.catchDefect(() => Effect.succeed(null)))
        if (content !== null) {
          files.set(file, content)
        }
      }
    }
    return files
  })

/**
 * Load every stamp recorded under `.cairn/**` into a `node path -> sha256` map.
 * A sidecar that can't be mapped back to a node path, or whose content is
 * corrupt/merge-conflicted/hand-edited (`parseStamp` returns `null`), is simply
 * skipped — its node then reads as `stale`/`missing`, never a crash (see
 * StampStore.ts's own contract). Absent `.cairn/` (first run) yields an empty
 * map via `dfs.listFiles`, also without error.
 */
const readStamps = (layout: MetaLayout): Effect.Effect<Map<string, string>, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const sidecarPaths = yield* dfs.listFiles([layout.metaRoot])
    const stamps = new Map<string, string>()
    for (const sidecarPath of sidecarPaths) {
      const nodeAtPath = nodePathForSidecar(sidecarPath, layout)
      if (nodeAtPath === null) {
        continue
      }
      const record = parseStamp(yield* dfs.readFile(sidecarPath))
      if (record !== null) {
        stamps.set(nodeAtPath, record.sha256)
      }
    }
    return stamps
  })

/** 0 when nothing is missing/stale, no orphan summaries, and no deleted-source
 * stamps remain, 1 otherwise. */
export const summaryExitCode = (plan: SummaryPlan): number =>
  plan.todo.length > 0 || plan.orphans.length > 0 || plan.orphanStamps.length > 0 ? 1 : 0

/** Report lines: methodology + the bottom-up update order, for a one-pass fix. */
export const formatSummaryReport = (plan: SummaryPlan, options: SummaryReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const stampCommand = options.stampCommand ?? DEFAULT_STAMP_COMMAND
  const totalOrphans = plan.orphans.length + plan.orphanStamps.length
  if (plan.todo.length === 0 && totalOrphans === 0) {
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
  // A `.cairn/**` sidecar with no corresponding node — its source (and possibly
  // its summary file too) was deleted; the sidecar, never touched by hand, is
  // what caught it (see StampStore.ts / SummaryTree.ts's `findDeletedStamps`).
  const orphanStampLines = plan.orphanStamps.map((p) =>
    pick(locale, {
      en: `  ✗ deleted-source stamp (sidecar left behind): ${p}`,
      fr: `  ✗ tampon d'une source supprimée (fichier annexe orphelin) : ${p}`,
    }),
  )
  if (plan.todo.length === 0) {
    return [
      pick(locale, {
        en: `❌ ${totalOrphans} orphan summary/ies or stamp(s) (source doc deleted, renamed, or below threshold):`,
        fr: `❌ ${totalOrphans} résumé(s) ou tampon(s) orphelin(s) (source supprimée, renommée, ou sous le seuil) :`,
      }),
      ...orphanLines,
      ...orphanStampLines,
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
  if (totalOrphans > 0) {
    lines.push(
      '',
      pick(locale, {
        en: `${totalOrphans} orphan summary/ies or stamp(s) (source doc deleted, renamed, or below threshold):`,
        fr: `${totalOrphans} résumé(s) ou tampon(s) orphelin(s) (source supprimée, renommée, ou sous le seuil) :`,
      }),
      ...orphanLines,
      ...orphanStampLines,
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
    const files = yield* readMarkdown(args.roots, args.trackedFiles)
    const stamps = yield* readStamps(layoutFor(args.base))
    return planSummaries(toPlanArgs(files, args, stamps))
  })

/** `--explain`: why each todo node is not ok (see `explainPlan` for what this can and cannot show). */
export const explainSummaries = (
  args: CheckSummariesArgs,
  options: SummaryReportOptions = {},
): Effect.Effect<string[], never, DocsFs> =>
  Effect.gen(function* () {
    const files = yield* readMarkdown(args.roots, args.trackedFiles)
    const stamps = yield* readStamps(layoutFor(args.base))
    const plan = planSummaries(toPlanArgs(files, args, stamps))
    return explainPlan(plan, files, options)
  })

/**
 * Stamp every EXISTING summary with its current source/manifest hash, bottom-up,
 * into its `.cairn/**` sidecar — never into the summary's own content. Summaries
 * whose content has not been authored yet are returned as `missing`.
 *
 * ALWAYS strips a legacy in-content `<!-- source-sha256 -->` stamp first, if one
 * is still there, before computing any hash — not just when explicitly asked to
 * migrate. This is the actual fix for the discoverability gap a one-off
 * `--migrate-stamps` command alone would leave: an upgrading repo's EXISTING
 * `stampCommand` (already `cairn check --summaries-only --stamp` in every
 * `.cairnrc.json` this tool ever scaffolded) is what a user or CI already runs
 * — making that command self-heal means there is no new command to discover,
 * search for, or forget to run. `--migrate-stamps` (`migrateStamps`, below)
 * still exists as an explicit, nameable entry point for anyone who wants to run
 * the cleanup as its own reported step, but it is no longer load-bearing.
 *
 * Doesn't need to load `stamps` first: this loop writes every node's hash
 * unconditionally (not just the stale ones), so `planSummaries`' ordering is all
 * it needs from the planner — freshness status plays no role in stamping itself.
 */
const stampFiles = (files: Map<string, string>, args: CheckSummariesArgs): Effect.Effect<StampResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const layout = layoutFor(args.base)

    // Only ever strips a SUMMARY file's own legacy stamp — never a plain source
    // doc. A source doc's prose can legitimately contain the literal
    // `<!-- source-sha256: <64hex> -->` text (e.g. a doc that documents cairn's
    // OWN former stamp format, with a real-looking example) — that text is the
    // user's content, not tool metadata, and `stampFiles` must never touch it.
    // Restricting to `isSummaryFile`/`isDirSummary` is what keeps "the tool
    // never writes into content" true for every file it doesn't own.
    let migrated = 0
    for (const [p, content] of files) {
      if (!isSummaryFile(p, args.naming) && !isDirSummary(p, args.naming)) {
        continue
      }
      const stripped = stripSourceHash(content)
      if (stripped !== content) {
        files.set(p, stripped)
        yield* dfs.writeFile(p, stripped)
        migrated += 1
      }
    }

    const order = planSummaries(toPlanArgs(files, args)).nodes

    const missing: PlanNode[] = []
    let stamped = 0
    for (const node of order) {
      if (!files.has(node.path)) {
        missing.push(node)
        continue
      }
      // A node's `inputs` are structurally stable (only summary CONTENT changes
      // during stamping, never which paths feed a node) — so its hash can be
      // recomputed directly from `inputs` + their current content. Content no
      // longer carries a stamp (that's the whole point of the sidecar), so —
      // unlike the old in-content scheme — a child's just-written sidecar never
      // changes ITS OWN content, and therefore never perturbs a parent's
      // manifest hash; bottom-up order is preserved for a single-pass write, but
      // no longer required for correctness of the hash itself.
      const expectedHash = nodeExpectedHash({ files, inputs: node.inputs, kind: node.kind, path: node.path })
      const sidecarContent = serializeStamp({ sha256: expectedHash, version: STAMP_VERSION })
      yield* dfs.writeFile(sidecarPathFor(node.path, layout), sidecarContent)
      stamped += 1
    }
    return { migrated, missing, stamped }
  })

export const stampSummaries = (args: CheckSummariesArgs): Effect.Effect<StampResult, never, DocsFs> =>
  Effect.gen(function* () {
    const files = yield* readMarkdown(args.roots, args.trackedFiles)
    return yield* stampFiles(files, args)
  })

/**
 * Explicit, nameable one-shot entry point (`--migrate-stamps`) for the SAME
 * self-healing `stampFiles` already does unconditionally on every `--stamp` —
 * kept for anyone who wants to run/report the cleanup as its own step, not
 * because plain `--stamp` needs it to be correct.
 */
export const migrateStamps = (args: CheckSummariesArgs): Effect.Effect<MigrateResult, never, DocsFs> =>
  Effect.gen(function* () {
    const files = yield* readMarkdown(args.roots, args.trackedFiles)
    return yield* stampFiles(files, args)
  })

/** Delete every orphan summary file (source doc gone) AND every orphan
 * `.cairn/**` sidecar (deleted-source stamp — see `SummaryPlan.orphanStamps`),
 * reporting the total count removed. */
export const pruneOrphans = (args: CheckSummariesArgs): Effect.Effect<number, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const layout = layoutFor(args.base)
    const files = yield* readMarkdown(args.roots, args.trackedFiles)
    const stamps = yield* readStamps(layout)
    const plan = planSummaries(toPlanArgs(files, args, stamps))
    for (const orphan of plan.orphans) {
      yield* dfs.deleteFile(orphan)
    }
    for (const orphanStamp of plan.orphanStamps) {
      yield* dfs.deleteFile(sidecarPathFor(orphanStamp, layout))
    }
    return plan.orphans.length + plan.orphanStamps.length
  })

// Re-exported so callers can recognise summary files without importing two modules.
export { isSummaryFile } from '../../core/summaries/DocSummaries.ts'
export { isDirSummary } from '../../core/summaries/SummaryTree.ts'
