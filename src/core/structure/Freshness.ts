// Pure logic for `checks.freshness` (see ../../program/structure/CheckFreshness.ts
// for the IO/plugin wiring, and docs/design/CONVENTION.md's "Judging this
// convention" section for why this is a SEPARATE, minimal check rather than
// another `CoverageRule` field): given a doc's own configured `maxAgeDays`
// threshold and its real last-commit date, is it stale? A purely TEMPORAL
// question — "how old is this doc, right now" — with no relational logic at
// all (no doc-to-doc graph, no kinds), deliberately kept this small so it
// stays independently testable without any IO or git double.

export interface FreshnessCandidate {
  /** `null` when git has no commit history at all for this path yet (a
   * brand-new, uncommitted doc) — not the same as "very old"; excluded from
   * staleness entirely rather than guessed at, matching this repo's own
   * "never silently guess" discipline (see `CheckFreshness.ts`'s own
   * comment on this exact distinction). */
  readonly lastCommitDate: Date | null
  readonly maxAgeDays: number
  readonly path: string
}

export interface StaleDoc {
  readonly ageDays: number
  readonly maxAgeDays: number
  readonly path: string
}

/** Every candidate whose real git age (in whole days, floored) exceeds its
 * own `maxAgeDays` — candidates with no commit history (`lastCommitDate ===
 * null`) are silently excluded, not reported stale or fresh: there is
 * nothing yet to measure an age from. Sorted by path for a deterministic
 * report, matching every sibling check's own sort discipline
 * (`docCoverageExitCode`'s `missing`/`unmatchedKinds`, `Coverage.ts`'s own
 * findings). */
export const findStaleDocs = (candidates: readonly FreshnessCandidate[], now: Date): readonly StaleDoc[] =>
  candidates
    .filter((c): c is FreshnessCandidate & { readonly lastCommitDate: Date } => c.lastCommitDate !== null)
    .map((c) => ({
      ageDays: Math.floor((now.getTime() - c.lastCommitDate.getTime()) / 86_400_000),
      maxAgeDays: c.maxAgeDays,
      path: c.path,
    }))
    .filter((c) => c.ageDays > c.maxAgeDays)
    .toSorted((a, b) => a.path.localeCompare(b.path))
