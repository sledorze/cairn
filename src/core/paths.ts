// Path normalisation. The pure planners reason in POSIX (`/`) paths so behaviour
// is identical on every OS; the IO layer normalises real filesystem paths (which
// may use `\` on Windows) to POSIX before they reach the core.

import * as nodePath from 'node:path'

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
