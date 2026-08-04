// Path normalisation. The pure planners reason in POSIX (`/`) paths so behaviour
// is identical on every OS; the IO layer normalises real filesystem paths (which
// may use `\` on Windows) to POSIX before they reach the core.

import * as nodePath from 'node:path'

import { matchesAny } from './glob.ts'

const path = nodePath.posix

/** Convert an OS path to POSIX form (`\` -> `/`). */
export const toPosix = (p: string): string => p.replaceAll('\\', '/')

/**
 * True when `candidate` resolves inside `base` (or equals it). The same
 * containment check `sidecar.ts`'s `sidecarPathFor`/`nodePathForSidecar`
 * use for sidecar paths — non-throwing here since callers (link-checking's
 * out-of-hierarchy targets, issue #39) need a boolean to decide "cannot
 * verify" from, not a programming-error signal.
 *
 * Segment-aware, not a bare string-prefix check on `rel` — adversarial
 * review found that `rel.startsWith('..')` alone misclassifies a
 * legitimate in-base path whose FIRST SEGMENT merely starts with the two
 * characters `..` (e.g. a real directory named `..weird` sitting inside
 * `base`; `path.relative` produces `'..weird/file.ts'`, which starts with
 * `'..'` as a string without being a `..`-parent-traversal segment at
 * all). `rel === '..'` (base's own immediate parent) or `rel` starting
 * with `'../'` (a traversal segment followed by a separator) are the only
 * two shapes that actually mean "escapes base."
 */
export const isWithinBase = (candidate: string, base: string): boolean => {
  const rel = path.relative(base, candidate)
  const escapes = rel === '..' || rel.startsWith('../')
  return !escapes && !path.isAbsolute(rel)
}

/**
 * `candidate` (absolute) expressed relative to `base` (also absolute), in
 * POSIX form — `candidate` itself if it isn't actually within `base`.
 * Exists so `ignore` glob patterns (issue #102) can be matched against the
 * path an author actually wrote (`.agents/**`, root-relative) instead of
 * the absolute filesystem path — a bare, non-`**`-prefixed pattern can
 * never match an absolute path, since the anchored regex `core/glob.ts`
 * compiles has no way to skip an arbitrary absolute-path prefix.
 */
export const relativeToBase = (candidate: string, base: string): string =>
  isWithinBase(candidate, base) ? toPosix(path.relative(base, candidate)) : toPosix(candidate)

/**
 * True when `p` is `r` itself, or lives under `r`, for at least one of `roots`
 * — a plain prefix check (not `isWithinBase`'s traversal-aware relative-path
 * logic), correct here because `roots`/`p` are always absolute POSIX paths
 * already, never a `..`-relative string that check exists to disambiguate.
 *
 * Extracted (issue #93's own PR, DRY audit) after this exact one-liner
 * turned up hand-duplicated, verbatim, across `SummaryTree.ts`'s own
 * `inScope`, `CheckLinks.ts`'s own `inRoots`, `DocsFs.ts`'s in-memory test
 * double's equivalent-but-operand-swapped copy, and (once issue #106's PR
 * merged to `main`) `CheckDeletions.ts`'s own `inScope` — same risk class
 * as `readMarkdownCorpus`'s extraction, just for a much smaller function.
 */
export const isInScope = (p: string, roots: readonly string[]): boolean =>
  roots.some((r) => p === r || p.startsWith(`${r}/`))

/**
 * True when `absPath` matches any of `patterns`, tried both as its absolute
 * POSIX path and, additionally, relative to `base` -- the same two-step
 * convention `isIgnored` (below) established for `ignore` globs, generalised
 * here for the same reason: a glob written the way anyone actually writes
 * one is authored relative to the project root, and a bare `matchesAny`
 * against an absolute path alone would never match it (issue #102).
 * Extracted after this exact check turned up independently re-derived,
 * verbatim but for the single-glob-vs-array-of-globs argument shape, in
 * both `CheckDocCoverage.ts`'s own `matchesConfiguredGlob` and
 * `CheckFreshness.ts`'s own `matchesRuleGlob` -- the same risk `isInScope`'s
 * own comment already flags this repo as having hit before (issue #93).
 */
export const matchesGlobNearBase = (absPath: string, base: string, patterns: readonly string[]): boolean =>
  matchesAny(toPosix(absPath), patterns) || matchesAny(relativeToBase(absPath, base), patterns)

/**
 * True when `candidate` (absolute) matches any of `ignore`'s glob patterns —
 * tested both as its absolute POSIX path (the pre-existing contract: a
 * pattern that IS the absolute path, or is `**`-prefixed so it can absorb
 * one, already worked) and, additionally, relative to whichever of `roots`
 * actually contains it (the issue #102 fix: a pattern with no leading `**`
 * segment, the form anyone writes for a top-level file or directory — e.g.
 * `docs/SKIP.md` — is authored root-relative and previously could never
 * match an absolute path at all). Every call site across the checkers that
 * filters a scanned file against `ignore` shares this exact match rule, so
 * it lives here once rather than re-deriving `matchesAny(f, ignore)`
 * against an absolute path at each site.
 */
export const isIgnored = (candidate: string, ignore: readonly string[], roots: readonly string[]): boolean => {
  if (ignore.length === 0) {
    return false
  }
  const absPosix = toPosix(candidate)
  if (matchesAny(absPosix, ignore)) {
    return true
  }
  const root = roots.find((r) => isWithinBase(candidate, r))
  return root !== undefined && matchesAny(relativeToBase(candidate, root), ignore)
}
