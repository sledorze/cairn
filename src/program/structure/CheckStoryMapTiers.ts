// Effect program for `checks.storyMapTiers`: a real, live drift found by auditing this
// repo's own docs — see `../../core/structure/StoryMapTiers.ts`'s own header for the full
// finding (every `docs/design/*/story-map.md` claims a marked walking-skeleton card exists
// per backbone step; none of the three actually had exactly one `(Must)`-tagged card per
// step). This file's only job is IO: find the docs matching `checks.storyMapTiers.globs`,
// read their content, and hand it to the pure `extractBackboneStepTiers` /
// `findWalkingSkeletonViolations` pair — no markdown-shape logic lives here.
//
// Follows the EXACT `checks.freshness`/`checks.docCoverage` precedent
// (`./CheckFreshness.ts`/`./CheckDocCoverage.ts`): opt-in via config presence alone (no CLI
// flag — `globs` has no CLI equivalent to express it with), registered in `cli.ts`'s
// `CheckPlugin` registry the same way, rejects `--json` the same way.

import { Data, Effect } from 'effect'

import type { StoryMapTiersConfig } from '../../core/Config.ts'
import { matchesGlobNearBase } from '../../core/paths.ts'
import type { WalkingSkeletonViolation } from '../../core/structure/StoryMapTiers.ts'
import { extractBackboneStepTiers, findWalkingSkeletonViolations } from '../../core/structure/StoryMapTiers.ts'
import { DocsFs, listMarkdownFiles } from '../../io/DocsFs.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

export interface CheckStoryMapTiersArgs {
  readonly base: string
  readonly globs: readonly string[]
  readonly ignore?: readonly string[]
  readonly roots: readonly string[]
  readonly trackedFiles?: ReadonlySet<string>
}

/** One doc's own violations, so a report can group by file (matching `StaleDoc`/
 * `DocCoverageResult`'s own "one row per problem, path included" shape). */
export interface StoryMapTiersDocViolations {
  readonly path: string
  readonly violations: readonly WalkingSkeletonViolation[]
}

export interface StoryMapTiersResult {
  readonly checked: number
  readonly docViolations: readonly StoryMapTiersDocViolations[]
}

/** 0 when nothing violates the walking-skeleton invariant, 1 otherwise. */
export const storyMapTiersExitCode = (result: StoryMapTiersResult): number => (result.docViolations.length > 0 ? 1 : 0)

export const checkStoryMapTiers = ({
  base,
  globs,
  ignore = [],
  roots,
  trackedFiles,
}: CheckStoryMapTiersArgs): Effect.Effect<StoryMapTiersResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const allDocs = yield* listMarkdownFiles(dfs, roots, ignore, trackedFiles)
    const matched = allDocs.filter((f) => matchesGlobNearBase(f, base, globs))

    const docViolations: StoryMapTiersDocViolations[] = []
    for (const docPath of matched) {
      // Same discipline as every sibling check: a file that lists fine but can't be READ
      // (permission denied) must not crash the whole run.
      const content = yield* dfs.readFile(docPath).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      if (content === null) {
        continue
      }
      const steps = extractBackboneStepTiers(content)
      const violations = findWalkingSkeletonViolations(steps)
      if (violations.length > 0) {
        docViolations.push({ path: docPath, violations })
      }
    }

    return { checked: matched.length, docViolations: docViolations.toSorted((a, b) => a.path.localeCompare(b.path)) }
  })

export interface StoryMapTiersReportOptions {
  readonly locale?: Locale
}

/** Human-readable report lines (pure, so it can be unit-tested). */
export const formatStoryMapTiersReport = (
  result: StoryMapTiersResult,
  options: StoryMapTiersReportOptions = {},
): string[] => {
  const locale = options.locale ?? 'en'
  const violationCount = result.docViolations.reduce((n, d) => n + d.violations.length, 0)
  const lines: string[] =
    violationCount > 0
      ? [
          pick(locale, {
            en: `❌ ${violationCount} backbone step(s) violate the walking-skeleton invariant (exactly one (Must)-tagged card per step):`,
            fr: `❌ ${violationCount} étape(s) de backbone violent l'invariant du walking skeleton (exactement une carte taguée (Must) par étape) :`,
          }),
        ]
      : [
          pick(locale, {
            en: `✅ Story-map walking skeleton OK (${result.checked} doc(s) checked).`,
            fr: `✅ Walking skeleton des story-maps OK (${result.checked} document(s) vérifié(s)).`,
          }),
        ]
  for (const doc of result.docViolations) {
    for (const v of doc.violations) {
      lines.push(
        pick(locale, {
          en: `  ${doc.path}:${v.line} step ${v.step} "${v.heading}" — ${v.mustCount} (Must)-tagged card(s), expected exactly 1`,
          fr: `  ${doc.path}:${v.line} étape ${v.step} « ${v.heading} » — ${v.mustCount} carte(s) taguée(s) (Must), 1 attendue`,
        }),
      )
    }
  }
  return lines
}

/** The single, named invariant-violation defect this file can raise — see
 * `no-raw-error`'s own rationale (this repo's falsestart guard, `.claude/settings.json`): a
 * plain `Error` erases which failure this is. `run` only ever raises this when `isEnabled`
 * should already have prevented the call — matches `freshnessPlugin`'s own
 * `FreshnessPluginMisuse` precedent (`./CheckFreshness.ts`). */
export class StoryMapTiersPluginMisuse extends Data.TaggedError('StoryMapTiersPluginMisuse')<{
  readonly message: string
}> {}

// The CheckPlugin descriptor cli.ts's registry runner drives — see
// ../checks/CheckPlugin.ts's own header for why this abstraction exists. `isEnabled`
// mirrors `docCoveragePlugin`/`freshnessPlugin`'s own exact shape: `checks.storyMapTiers`
// has no CLI flag (its `globs` has no CLI equivalent to express it with), so mere presence
// in config IS the opt-in.
//
// `satisfies CheckPlugin<StoryMapTiersResult>`, not a `: CheckPlugin<...>` annotation —
// matching `freshnessPlugin`'s own precedent (this repo's `prefer-smart-constructor` guard
// blocks `const $NAME: $TYPE = { ... }` as an unchecked shape assertion).
export const storyMapTiersPlugin = {
  exitCode: storyMapTiersExitCode,
  format: (result: StoryMapTiersResult, options: StoryMapTiersReportOptions) =>
    formatStoryMapTiersReport(result, options),
  isEnabled: (resolved) => resolved.checks.storyMapTiers !== null,
  jsonUnsupportedMessage: '--json cannot be combined with checks.storyMapTiers yet',
  name: 'storyMapTiers',
  run: ({ base, ignore, resolved, roots, trackedFiles }) => {
    const storyMapTiers: StoryMapTiersConfig | null = resolved.checks.storyMapTiers
    if (storyMapTiers === null) {
      return Effect.die(
        new StoryMapTiersPluginMisuse({
          message:
            'storyMapTiersPlugin.run called with checks.storyMapTiers disabled — isEnabled() should have prevented this',
        }),
      )
    }
    return checkStoryMapTiers({
      base,
      globs: storyMapTiers.globs,
      ignore,
      roots,
      ...(trackedFiles === undefined ? {} : { trackedFiles }),
    })
  },
} satisfies CheckPlugin<StoryMapTiersResult, DocsFs>
