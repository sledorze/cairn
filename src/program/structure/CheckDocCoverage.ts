// Effect program for issue #108: "No way to require that documentation covers
// the source tree." `checks.coverage` only ever asks doc→doc questions ("does a
// doc of kind X link to a doc of kind Y"); this asks the missing direction —
// does some EXISTING doc already link to this SOURCE FILE — without requiring a
// markdown file per source file (that idea was explicitly rejected: this reads
// what's already there, never generates anything).
//
// Scans the whole `base` tree (not just doc `roots`, since source files live
// outside them) via the SAME `DocsFs.listFiles` + `ignore` pruning every other
// check already uses — inheriting the node_modules-OOM fix (issue #63) and
// `onlyGitTracked` CI-parity (issue #48) for free, rather than hand-rolling a
// second file-discovery mechanism with its own ignore hygiene to get wrong.
// `listFiles`'s own `ignore` only prunes DIRECTORIES, never a file-shaped
// pattern (see `DocsFs.ts`'s own `isPrunedDir` comment) — both the `sources`
// filter AND the `coveredBy` doc-files filter below re-check `isIgnored` per
// file for exactly that reason, matching `listMarkdownFiles`'s own
// established re-check (adversarial review: an earlier version of this file
// only re-checked it on the `sources` side, letting an ignored/generated
// `.md` file still count as a legitimate covering doc).
//
// The pure "which source paths have no covering link" / "which coveredBy kind
// matched zero real docs" logic lives in `../../core/structure/DocCoverage.ts`;
// this file's own job is purely IO — listing files, reading `coveredBy` docs'
// content, extracting their real outbound references (`extractReferences`,
// the SAME extractor `CheckRefs.ts` already uses) and resolving each to an
// absolute path, non-transitively (one hop only, matching `checks.coverage`'s
// own established principle — see `DocCoverage.ts`'s own header for why).

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import type { DocCoverageGroup } from '../../core/Config.ts'
import { extractReferences } from '../../core/links/MarkdownLinks.ts'
import { isIgnored, matchesGlobNearBase, toPosix } from '../../core/paths.ts'
import { findUncoveredSources, findUnmatchedKinds } from '../../core/structure/DocCoverage.ts'
import { DocsFs } from '../../io/DocsFs.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

const path = nodePath.posix

export interface CheckDocCoverageArgs {
  readonly base: string
  readonly coveredBy: readonly DocCoverageGroup[]
  readonly exempt?: readonly string[]
  readonly ignore?: readonly string[]
  readonly sources: readonly string[]
  /** Issue #48 CI parity, same as every sibling check: when supplied,
   * narrows both the source-file universe and the coveredBy-doc universe to
   * tracked/staged paths only. */
  readonly trackedFiles?: ReadonlySet<string>
}

export interface DocCoverageResult {
  readonly checked: number
  readonly missing: readonly string[]
  readonly unmatchedKinds: readonly string[]
}

/** 0 when nothing is missing, 1 otherwise — `unmatchedKinds` is a hint, like
 * `checks.coverage`'s own, and never affects this. */
export const docCoverageExitCode = (result: DocCoverageResult): number => (result.missing.length > 0 ? 1 : 0)

export const checkDocCoverage = ({
  base,
  coveredBy,
  exempt = [],
  ignore = [],
  sources,
  trackedFiles,
}: CheckDocCoverageArgs): Effect.Effect<DocCoverageResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const allFiles = yield* dfs.listFiles([base], ignore)
    const inTracked = (f: string): boolean => trackedFiles === undefined || trackedFiles.has(f)

    const sourcePaths = allFiles.filter(
      (f) =>
        inTracked(f) &&
        matchesGlobNearBase(f, base, sources) &&
        !isIgnored(f, ignore, [base]) &&
        !matchesGlobNearBase(f, base, exempt),
    )
    const sourcePathSet = new Set(sourcePaths)

    const matchedCounts = new Map<string, number>()
    const coverageByPath = new Map<string, Set<string>>()

    for (const group of coveredBy) {
      const docFiles = allFiles.filter(
        (f) =>
          f.endsWith('.md') &&
          inTracked(f) &&
          matchesGlobNearBase(f, base, [group.glob]) &&
          !isIgnored(f, ignore, [base]),
      )
      matchedCounts.set(group.kind, (matchedCounts.get(group.kind) ?? 0) + docFiles.length)

      for (const docPath of docFiles) {
        // Same discipline as every sibling check: a file that lists fine but
        // can't be READ (permission denied) must not crash the whole run.
        const content = yield* dfs.readFile(docPath).pipe(Effect.catchDefect(() => Effect.succeed(null)))
        if (content === null) {
          continue
        }
        const fromDir = path.dirname(docPath)
        for (const ref of extractReferences(content)) {
          const targetAbs = toPosix(path.resolve(fromDir, ref.target))
          if (!sourcePathSet.has(targetAbs)) {
            continue
          }
          const kinds = coverageByPath.get(targetAbs) ?? new Set<string>()
          kinds.add(group.kind)
          coverageByPath.set(targetAbs, kinds)
        }
      }
    }

    const missing = findUncoveredSources({ coverageByPath, sourcePaths }).toSorted()
    const unmatchedKinds = findUnmatchedKinds({ coveredBy, matchedCounts }).toSorted()
    return { checked: sourcePaths.length, missing, unmatchedKinds }
  })

export interface DocCoverageReportOptions {
  readonly locale?: Locale
}

/** Human-readable report lines (pure, so it can be unit-tested). */
export const formatDocCoverageReport = (
  result: DocCoverageResult,
  options: DocCoverageReportOptions = {},
): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] =
    result.missing.length > 0
      ? [
          pick(locale, {
            en: `❌ ${result.missing.length} source file(s) not covered by any documentation:`,
            fr: `❌ ${result.missing.length} fichier(s) source non couvert(s) par la documentation :`,
          }),
        ]
      : [
          pick(locale, {
            en: `✅ Source coverage OK (${result.checked} file(s) checked).`,
            fr: `✅ Couverture des sources OK (${result.checked} fichier(s) vérifié(s)).`,
          }),
        ]
  for (const p of result.missing) {
    lines.push(`  ${p}`)
  }
  for (const kind of result.unmatchedKinds) {
    lines.push(
      pick(locale, {
        en: `⚠️  coveredBy kind "${kind}" matched 0 doc files — check its glob, or that it is simply not typo'd.`,
        fr: `⚠️  le groupe coveredBy "${kind}" ne correspond à aucun document — vérifiez son glob, ou une faute de frappe.`,
      }),
    )
  }
  return lines
}

// The CheckPlugin descriptor cli.ts's registry runner drives — see
// ../checks/CheckPlugin.ts's own header for why this abstraction exists.
// `isEnabled` mirrors `coveragePlugin`'s own exact shape: `checks.docCoverage`
// has no CLI flag (its `coveredBy`/`sources` globs have no CLI equivalent to
// express them with), so mere presence in config IS the opt-in. `run` still
// checks `resolved.checks.docCoverage` explicitly and dies with a named
// defect rather than trusting an unguarded cast, matching `coveragePlugin`'s
// own precedent (an adversarial-review finding there, applied here from the
// start instead of found the same way twice).
export const docCoveragePlugin: CheckPlugin<DocCoverageResult> = {
  exitCode: docCoverageExitCode,
  format: (result, options) => formatDocCoverageReport(result, options),
  isEnabled: (resolved) => resolved.checks.docCoverage !== null,
  jsonUnsupportedMessage: '--json cannot be combined with checks.docCoverage yet',
  name: 'docCoverage',
  run: ({ base, ignore, resolved, trackedFiles }) => {
    const docCoverage = resolved.checks.docCoverage
    if (docCoverage === null) {
      return Effect.die(
        new Error(
          'docCoveragePlugin.run called with checks.docCoverage disabled — isEnabled() should have prevented this',
        ),
      )
    }
    const { coveredBy, exempt, sources } = docCoverage
    return checkDocCoverage({
      base,
      coveredBy,
      exempt,
      ignore,
      sources,
      ...(trackedFiles === undefined ? {} : { trackedFiles }),
    })
  },
}
