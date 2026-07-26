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
 */
export const isWithinBase = (candidate: string, base: string): boolean => {
  const rel = path.relative(base, candidate)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}
