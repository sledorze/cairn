// Effect program for issue #106: link-completeness and content hashing both
// assume tracked content persists — nothing notices content that vanishes. A
// doc deleted on the correct belief that it was pure duplication can still
// carry a heading or outbound reference that existed nowhere else, and
// `cairn check` stays green afterward regardless (the tree got smaller, the
// hashes re-stamped, the delta simply gone). `checkDeletions` is opt-in
// (`--report-deletions`, no CLI equivalent of `checks.summaries`/`links`'
// default-on gate) and INFORMATIONAL ONLY: `deletionsExitCode` always
// returns 0. Blocking would be wrong — deleting genuinely redundant
// documentation is a good thing that should stay cheap (the issue's own
// explicit framing); this is a report, not a verdict.
//
// Detection needs the DELETED doc's last-known content, which only git can
// still supply once a file is gone from the working tree — `GitFs.
// listDeletedSince`/`readFileAtRef` (see io/Git.ts). Comparing against
// `HEAD` (the default) catches an uncommitted `rm`, suited to a pre-commit
// hook; comparing against a PR's base branch (e.g. `origin/main`) via
// `ref` catches every deletion the PR itself introduces, including ones
// already committed — the issue's own reported scenario ("deleted a doc,
// only noticed hours later").

import { Effect } from 'effect'

import type { DeletedDocContentFinding } from '../../core/summaries/DeletionReport.ts'
import { findDeletedDocContent } from '../../core/summaries/DeletionReport.ts'
import { DEFAULT_NAMING, isSummaryFile } from '../../core/summaries/DocSummaries.ts'
import type { Naming } from '../../core/summaries/DocSummaries.ts'
import { isDirSummary } from '../../core/summaries/SummaryTree.ts'
import { isIgnored } from '../../core/paths.ts'
import { DocsFs } from '../../io/DocsFs.ts'
import type { GitUnavailableError } from '../../io/Git.ts'
import { GitFs } from '../../io/Git.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

export interface CheckDeletionsArgs {
  readonly base: string
  readonly ignore?: readonly string[]
  readonly naming?: Naming
  /** Git ref to compare the current working tree against. Default `HEAD`
   * (catches an uncommitted deletion); pass a PR's base branch (e.g.
   * `origin/main`) in CI to catch every deletion the PR itself introduces,
   * including already-committed ones. */
  readonly ref?: string
  readonly roots: readonly string[]
}

export interface DeletionsResult {
  /** Deleted docs whose content was actually recoverable and compared —
   * distinct from every path `listDeletedSince` reported, since a
   * staged-but-never-committed path has nothing recoverable at `ref` and
   * is silently skipped, not counted. */
  readonly checked: number
  readonly findings: readonly DeletedDocContentFinding[]
}

/** Always 0 — informational only, by design (see this module's own header). */
export const deletionsExitCode = (_result: DeletionsResult): number => 0

const inScope = (p: string, roots: readonly string[]): boolean => roots.some((r) => p === r || p.startsWith(`${r}/`))

const readMarkdownCorpus = (
  roots: readonly string[],
  ignore: readonly string[],
): Effect.Effect<Map<string, string>, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const all = yield* dfs.listFiles(roots, ignore)
    const files = new Map<string, string>()
    for (const file of all) {
      if (!file.endsWith('.md') || isIgnored(file, ignore, roots)) {
        continue
      }
      const content = yield* dfs.readFile(file).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      if (content !== null) {
        files.set(file, content)
      }
    }
    return files
  })

export const checkDeletions = ({
  base,
  ignore = [],
  naming = DEFAULT_NAMING,
  ref = 'HEAD',
  roots,
}: CheckDeletionsArgs): Effect.Effect<DeletionsResult, GitUnavailableError, DocsFs | GitFs> =>
  Effect.gen(function* () {
    const gitFs = yield* GitFs
    const remainingFiles = yield* readMarkdownCorpus(roots, ignore)
    const deletedPaths = yield* gitFs.listDeletedSince(base, ref)

    // Excludes summary artifacts (`.summary.md`/`_SUMMARY.md`) themselves —
    // a summary/dir-summary that goes missing is `findOrphans`/
    // `findDeletedStamps`'s own, already-tracked concern (SummaryTree.ts).
    // That said, those two only detect the ABSENCE of the artifact, not
    // what CONTENT it carried — a hand-authored aside inside a `.summary.md`
    // (rare, since summaries are meant to digest their source doc, but not
    // impossible) is a genuine blind spot neither this check nor those two
    // catches. Named here rather than silently glossed over; not fixed in
    // this PR, since `--report-deletions` is scoped to SOURCE docs, the
    // same way `SummaryTree.ts`'s own `sourceDocs` filter is.
    const inScopeDeleted = deletedPaths.filter(
      (p) =>
        p.endsWith('.md') &&
        inScope(p, roots) &&
        !isIgnored(p, ignore, roots) &&
        !isSummaryFile(p, naming) &&
        !isDirSummary(p, naming),
    )

    // `listDeletedSince` above already succeeded against `ref` — a SETUP-
    // level problem (an invalid `ref`, git unavailable) would have failed
    // there already, and does propagate (caught by the caller, `cli.ts`,
    // as a visible warning; see its own comment). Once that's confirmed
    // good, a PER-PATH `readFileAtRef` failure (a corrupt object for that
    // one blob) is a different, narrower problem — degrading it gracefully
    // here, the same leniency `readMarkdownCorpus` above already gives an
    // unreadable file in the CURRENT corpus, means one corrupt deleted doc
    // doesn't cost every other deleted doc its own, otherwise-perfectly-
    // detectable finding (issue #106 adversarial review, second pass).
    const deletedDocs = new Map<string, string>()
    for (const p of inScopeDeleted) {
      const content = yield* gitFs.readFileAtRef(base, ref, p).pipe(Effect.catch(() => Effect.succeed(null)))
      if (content !== null) {
        deletedDocs.set(p, content)
      }
    }

    const findings = findDeletedDocContent({ deletedDocs, remainingFiles })
    return { checked: deletedDocs.size, findings }
  })

export interface DeletionsReportOptions {
  readonly locale?: Locale
}

/** Human-readable report lines (pure, so it can be unit-tested). Always
 * informational — see `deletionsExitCode`. */
export const formatDeletionsReport = (result: DeletionsResult, options: DeletionsReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  if (result.findings.length === 0) {
    return [
      pick(locale, {
        en: `✅ No orphaned content found (${result.checked} deletion(s) checked).`,
        fr: `✅ Aucun contenu orphelin trouvé (${result.checked} suppression(s) vérifiée(s)).`,
      }),
    ]
  }
  const lines: string[] = [
    pick(locale, {
      en: `⚠️  ${result.findings.length} deleted doc(s) took content with them, found nowhere else:`,
      fr: `⚠️  ${result.findings.length} document(s) supprimé(s) ont emporté du contenu introuvable ailleurs :`,
    }),
  ]
  for (const finding of result.findings) {
    lines.push(`  ${finding.path}`)
    for (const heading of finding.orphanedHeadings) {
      lines.push(`    ${pick(locale, { en: 'heading nowhere else', fr: 'titre introuvable ailleurs' })}: ${heading}`)
    }
    for (const target of finding.orphanedLinkTargets) {
      lines.push(
        `    ${pick(locale, { en: 'link target nowhere else', fr: 'cible de lien introuvable ailleurs' })}: ${target}`,
      )
    }
  }
  return lines
}
