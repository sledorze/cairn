// Effect program for `checks.freshness`: a minimal, separately opt-in check
// — "when was this doc's content last meaningfully touched, compared to its
// own configured `maxAgeDays` threshold." See `../../core/Config.ts`'s
// `FreshnessRuleInputSchema` comment, and docs/design/CONVENTION.md's
// "Judging this convention" section, for why this is its own check rather
// than a `CoverageRule` field: freshness is a TEMPORAL axis ("how old is
// this doc"), not a RELATIONAL one ("does this doc link to that doc") — the
// same axis `checks.coverage`/`checks.docCoverage` never ask about, and
// deliberately no cross-doc logic at all here, just per-doc age.
//
// "Last meaningfully touched" is git's own committer date for the doc's
// exact path (`GitFs.lastCommitDate`, ../../io/Git.ts), NOT filesystem
// mtime — mtime resets to checkout time on every fresh `git clone`/CI
// checkout regardless of a doc's real history, which would make every doc
// look brand-new the moment CI runs. A doc with no commit history yet
// (`lastCommitDate` returns `null`) is silently excluded from staleness
// reporting entirely (`../../core/structure/Freshness.ts`'s own
// `findStaleDocs`) — there's nothing yet to measure an age from, which
// isn't the same as "fresh."
//
// A real git failure (not "no history for this path," but git itself being
// unavailable — no `.git`, no `git` binary) is a genuinely different case:
// per-path, it's treated the same as "no history" (skipped, not reported
// stale), matching this check's own opt-in, best-effort posture and
// `cli.ts`'s existing `--report-deletions` precedent (a git-backed optional
// feature that degrades rather than aborting the whole `cairn check` run).
// Unlike a fully silent skip, though, this surfaces as a visible, non-fatal
// warning the moment EVERY candidate doc comes back with no git data at
// all — the same "a non-fatal hint naming the real likely cause" posture
// `checks.coverage`/`checks.docCoverage`'s own `unmatchedKinds` warning
// already established, so a genuinely broken git setup doesn't masquerade
// as "nothing is stale."

import { Data, Effect } from 'effect'

import type { FreshnessRule } from '../../core/Config.ts'
import { matchesGlobNearBase } from '../../core/paths.ts'
import type { FreshnessCandidate, StaleDoc } from '../../core/structure/Freshness.ts'
import { findStaleDocs } from '../../core/structure/Freshness.ts'
import { DocsFs, listMarkdownFiles } from '../../io/DocsFs.ts'
import { GitFs } from '../../io/Git.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

export interface CheckFreshnessArgs {
  readonly base: string
  readonly ignore?: readonly string[]
  /** Injectable purely for deterministic testing — real callers always omit
   * this and get `new Date()`. */
  readonly now?: Date
  readonly roots: readonly string[]
  readonly rules: readonly FreshnessRule[]
  readonly trackedFiles?: ReadonlySet<string>
}

export interface FreshnessResult {
  /** How many in-scope docs matched at least one rule — the same
   * "what did this actually look at" transparency `RefsCheckResult.checked`/
   * `DocCoverageResult.checked` already give. */
  readonly checked: number
  readonly stale: readonly StaleDoc[]
  /** How many of `checked` came back with NO git commit history at all
   * (brand-new OR git itself unavailable for that path) — surfaced as a
   * non-fatal warning by `formatFreshnessReport` only when it equals
   * `checked` and `checked > 0`: every other case is the ordinary,
   * expected "some docs are simply new" shape, not a sign anything is
   * broken. */
  readonly noHistory: number
}

/** 0 when nothing is stale, 1 otherwise — `noHistory` is a hint, like
 * `checks.coverage`'s own `unmatchedKinds`, and never affects this. */
export const freshnessExitCode = (result: FreshnessResult): number => (result.stale.length > 0 ? 1 : 0)

/** The FIRST rule (declared order) whose glob matches `absPath`, or
 * `undefined` when no rule applies — same "first match wins" ordering
 * discipline `core/structure/DocMetadata.ts`'s own kind-classification
 * already follows (GitHub issue #29's locked decision), applied here for
 * the same reason: predictable, position-based resolution instead of an
 * unspecified "which of several matching rules wins." Glob matching itself
 * (both-absolute-and-relative-to-base) is `../../core/paths.ts`'s own
 * `matchesGlobNearBase` — see that function's own comment for why this used
 * to be a locally re-derived copy. */
const matchingRule = (absPath: string, base: string, rules: readonly FreshnessRule[]): FreshnessRule | undefined =>
  rules.find((rule) => matchesGlobNearBase(absPath, base, [rule.glob]))

export const checkFreshness = ({
  base,
  ignore = [],
  now = new Date(),
  roots,
  rules,
  trackedFiles,
}: CheckFreshnessArgs): Effect.Effect<FreshnessResult, never, DocsFs | GitFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const gitFs = yield* GitFs
    const docs = yield* listMarkdownFiles(dfs, roots, ignore, trackedFiles)

    const candidates: FreshnessCandidate[] = []
    let noHistory = 0
    for (const docPath of docs) {
      const rule = matchingRule(docPath, base, rules)
      if (rule === undefined) {
        continue
      }
      // A real `GitUnavailableError` (missing `.git`, missing `git` binary,
      // …) is treated the same as "no history for this path" — see this
      // file's own header for why that's a deliberate, documented choice
      // rather than a silent catch-all.
      const lastCommitDate = yield* gitFs.lastCommitDate(base, docPath).pipe(Effect.catch(() => Effect.succeed(null)))
      if (lastCommitDate === null) {
        noHistory += 1
      }
      candidates.push({ lastCommitDate, maxAgeDays: rule.maxAgeDays, path: docPath })
    }

    const stale = findStaleDocs(candidates, now)
    return { checked: candidates.length, noHistory, stale }
  })

export interface FreshnessReportOptions {
  readonly locale?: Locale
}

/** Human-readable report lines (pure, so it can be unit-tested). */
export const formatFreshnessReport = (result: FreshnessResult, options: FreshnessReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] =
    result.stale.length > 0
      ? [
          pick(locale, {
            en: `❌ ${result.stale.length} doc(s) stale (git history older than their configured maxAgeDays):`,
            fr: `❌ ${result.stale.length} document(s) obsolète(s) (historique git plus ancien que leur maxAgeDays configuré) :`,
          }),
        ]
      : [
          pick(locale, {
            en: `✅ Freshness OK (${result.checked} doc(s) checked).`,
            fr: `✅ Fraîcheur OK (${result.checked} document(s) vérifié(s)).`,
          }),
        ]
  for (const doc of result.stale) {
    lines.push(`  ${doc.path} (${doc.ageDays}d > ${doc.maxAgeDays}d)`)
  }
  if (result.checked > 0 && result.noHistory === result.checked) {
    lines.push(
      pick(locale, {
        en: `⚠️  git returned no commit history for any of the ${result.checked} doc(s) matching a freshness rule — is this a git repository?`,
        fr: `⚠️  git n'a retourné aucun historique de commit pour les ${result.checked} document(s) correspondant à une règle de fraîcheur — s'agit-il bien d'un dépôt git ?`,
      }),
    )
  }
  return lines
}

/** The single, named invariant-violation defect this file can raise — see
 * `no-raw-error`'s own rationale (this repo's falsestart guard,
 * `.claude/settings.json`): a plain `Error` erases which failure this is,
 * so every catch site would have to string-match a message instead of
 * addressing it by tag. `run` only ever raises this when `isEnabled` should
 * already have prevented the call — a real "this should be impossible"
 * defect, matching `coveragePlugin`/`docCoveragePlugin`'s own equivalent
 * guard (their own raw-`Error` version predates this guard; not revisited
 * here, out of this change's scope). */
export class FreshnessPluginMisuse extends Data.TaggedError('FreshnessPluginMisuse')<{ readonly message: string }> {}

// The CheckPlugin descriptor cli.ts's registry runner drives — see
// ../checks/CheckPlugin.ts's own header for why this abstraction exists.
// `isEnabled` mirrors `coveragePlugin`/`docCoveragePlugin`'s own exact
// shape: `checks.freshness` has no CLI flag (its `rules` glob/maxAgeDays
// pairs have no CLI equivalent to express them with), so mere presence in
// config IS the opt-in.
//
// `satisfies CheckPlugin<FreshnessResult>`, not a `: CheckPlugin<...>`
// annotation — this repo's own falsestart guard (`prefer-smart-constructor`)
// blocks `const $NAME: $TYPE = { ... }` as an unchecked shape assertion;
// `satisfies` gets the identical structural check (and better inference —
// the object's own literal type is preserved) without that exact shape.
// Sibling plugins (`coveragePlugin`, `docCoveragePlugin`, `linksPlugin`)
// predate the guard and still use `:` — left as-is, out of this change's
// scope.
export const freshnessPlugin = {
  exitCode: freshnessExitCode,
  format: (result: FreshnessResult, options: FreshnessReportOptions) => formatFreshnessReport(result, options),
  isEnabled: (resolved) => resolved.checks.freshness !== null,
  jsonUnsupportedMessage: '--json cannot be combined with checks.freshness yet',
  name: 'freshness',
  run: ({ base, ignore, resolved, roots, trackedFiles }) => {
    const freshness = resolved.checks.freshness
    if (freshness === null) {
      return Effect.die(
        new FreshnessPluginMisuse({
          message: 'freshnessPlugin.run called with checks.freshness disabled — isEnabled() should have prevented this',
        }),
      )
    }
    return checkFreshness({
      base,
      ignore,
      roots,
      rules: freshness.rules,
      ...(trackedFiles === undefined ? {} : { trackedFiles }),
    })
  },
} satisfies CheckPlugin<FreshnessResult, DocsFs | GitFs>
