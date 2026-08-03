// Issue #108: pure logic for source-tree coverage — "every source file matching
// `sources` is linked to by at least one doc matching one of the `coveredBy`
// groups." Deliberately separate from `Coverage.ts`'s doc→doc `resolveRuleEdges`:
// that engine assumes every classified entity is a scanned markdown doc with its
// own `nodes`/refs; a source file (a `.ts` file, say) has none. This file only
// ever sees the RESULT of resolving links (`coverageByPath`, built by the IO
// layer in `../../program/structure/CheckDocCoverage.ts`), never markdown
// content itself — so it stays pure and independently testable.
//
// Non-transitive by construction, matching `Coverage.ts`'s own established
// principle (docs/adr/0002): `coverageByPath` is built from each covering doc's
// OWN direct outbound references only, never a chain through an intermediate
// doc — there is no code path here (or in the IO layer) that follows a
// reference more than one hop.

export interface DocCoverageArgs {
  /** `sourcePath -> the set of coveredBy `kind`s that link to it directly.
   * A path absent from this map, or present with an empty set, has no
   * covering link at all. */
  readonly coverageByPath: ReadonlyMap<string, ReadonlySet<string>>
  readonly sourcePaths: readonly string[]
}

/** Every source path with no direct inbound link from any `coveredBy` group. */
export const findUncoveredSources = ({ coverageByPath, sourcePaths }: DocCoverageArgs): readonly string[] =>
  sourcePaths.filter((p) => (coverageByPath.get(p)?.size ?? 0) === 0)

export interface UnmatchedKindsArgs {
  readonly coveredBy: readonly { readonly kind: string }[]
  /** `kind -> how many real doc files were found matching that group's glob`,
   * independent of whether any of them actually link anywhere — a kind that
   * matched zero real files is very likely a typo'd glob, the same "kind
   * matched 0 scanned docs" trap `checks.coverage`'s own `unmatchedKinds`
   * already guards against (see `Coverage.ts`). */
  readonly matchedCounts: ReadonlyMap<string, number>
}

/** Every declared `coveredBy` kind whose glob matched zero real doc files. */
export const findUnmatchedKinds = ({ coveredBy, matchedCounts }: UnmatchedKindsArgs): readonly string[] =>
  coveredBy.map((c) => c.kind).filter((kind) => (matchedCounts.get(kind) ?? 0) === 0)
