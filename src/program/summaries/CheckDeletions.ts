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
import { isIgnored, isInScope } from '../../core/paths.ts'
import { DocsFs, readMarkdownCorpus } from '../../io/DocsFs.ts'
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
  /** Issue #48 CI parity, same as every sibling check (CheckSummaries.ts,
   * CheckLinks.ts, CheckRefs.ts, CheckProseRefs.ts, CheckCoverage.ts): when
   * `onlyGitTracked` is on, narrows the REMAINING corpus to tracked/staged
   * paths only. Without this, an untracked scratch doc could make a
   * genuinely-orphaned heading look like it "survives" — a false negative
   * a real CI checkout (which never sees that file) wouldn't reproduce. */
  readonly trackedFiles?: ReadonlySet<string>
}

export interface DeletionsResult {
  /** Deleted docs whose content was actually recoverable and compared —
   * distinct from every path `listDeletedSince` reported; see `skipped`
   * for the ones that weren't. */
  readonly checked: number
  readonly findings: readonly DeletedDocContentFinding[]
  /** A deleted doc `listDeletedSince` reported but whose content couldn't
   * be recovered at `ref` (a corrupt object, or genuinely nothing there —
   * e.g. staged but never committed). Named explicitly, never silently
   * absorbed into `checked` — matches `CheckLinks.ts`'s own established
   * `unreadable` precedent for this exact codebase: a doc that can't be
   * read is itself worth knowing about, not just invisible to the count
   * (issue #106 audit: a repo with real git object corruption deserves to
   * see that, not a quietly smaller `checked` number). Never affects
   * `deletionsExitCode` — informational, like everything else here. */
  readonly skipped: readonly string[]
}

/** Always 0 — informational only, by design (see this module's own header). */
export const deletionsExitCode = (_result: DeletionsResult): number => 0

export const checkDeletions = ({
  base,
  ignore = [],
  naming = DEFAULT_NAMING,
  ref = 'HEAD',
  roots,
  trackedFiles,
}: CheckDeletionsArgs): Effect.Effect<DeletionsResult, GitUnavailableError, DocsFs | GitFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const gitFs = yield* GitFs
    const remainingFiles = yield* readMarkdownCorpus(dfs, roots, ignore, trackedFiles)
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
        isInScope(p, roots) &&
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
    const skipped: string[] = []
    for (const p of inScopeDeleted) {
      const content = yield* gitFs.readFileAtRef(base, ref, p).pipe(Effect.catch(() => Effect.succeed(null)))
      if (content === null) {
        skipped.push(p)
      } else {
        deletedDocs.set(p, content)
      }
    }

    const findings = findDeletedDocContent({ deletedDocs, remainingFiles })
    return { checked: deletedDocs.size, findings, skipped: skipped.toSorted() }
  })

export interface DeletionsReportOptions {
  readonly locale?: Locale
}

/** Human-readable report lines (pure, so it can be unit-tested). Always
 * informational — see `deletionsExitCode`. */
export const formatDeletionsReport = (result: DeletionsResult, options: DeletionsReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  // "0 checked, nothing found" and "N checked, nothing found" read
  // identically as an unqualified ✅ — misleadingly so, since the first is
  // "there was nothing to compare" (the common case for a bare local run
  // against the default `HEAD`, right after clone with no local
  // deletions) and the second is "compared N docs and none lost anything"
  // — a much stronger claim. Distinguished explicitly (issue #106
  // "best value defaults" audit) rather than letting a green checkmark
  // imply verification that didn't happen.
  const lines: string[] =
    result.findings.length > 0
      ? [
          pick(locale, {
            en: `⚠️  ${result.findings.length} deleted doc(s) took content with them, found nowhere else:`,
            fr: `⚠️  ${result.findings.length} document(s) supprimé(s) ont emporté du contenu introuvable ailleurs :`,
          }),
        ]
      : result.checked === 0
        ? [
            pick(locale, {
              en: 'ℹ️  Nothing deleted since the compared ref — nothing to check. Pass --deletions-since <ref> (e.g. a PR base branch) to check deletions already committed on this branch.',
              fr: "ℹ️  Rien n'a été supprimé depuis la référence comparée — rien à vérifier. Passez --deletions-since <ref> (par ex. une branche de base de PR) pour vérifier les suppressions déjà commises sur cette branche.",
            }),
          ]
        : [
            pick(locale, {
              en: `✅ No orphaned content found (${result.checked} deletion(s) checked).`,
              fr: `✅ Aucun contenu orphelin trouvé (${result.checked} suppression(s) vérifiée(s)).`,
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
  if (result.skipped.length > 0) {
    lines.push(
      pick(locale, {
        en: `⚠️  ${result.skipped.length} deleted doc(s) could not be read back at the ref (possibly corrupt) — not checked:`,
        fr: `⚠️  ${result.skipped.length} document(s) supprimé(s) n'ont pas pu être relus à cette référence (peut-être corrompus) — non vérifiés :`,
      }),
    )
    for (const path of result.skipped) {
      lines.push(`  ${path}`)
    }
  }
  return lines
}
