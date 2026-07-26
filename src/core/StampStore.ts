// The hidden, hierarchy-mirroring metadata tree that replaces the in-content
// `<!-- source-sha256: H -->` stamp (see AGENTS.md / issue #35).
//
// Every summarizable node keeps its authored prose stamp-free; instead, a sidecar
// JSON file under `<base>/.cairn/` mirrors the node's path 1:1 and carries the
// freshness hash. This module is pure (no IO): path mapping + (de)serialisation
// only. `program/CheckSummaries.ts` is the impure edge that reads/writes sidecars
// via `DocsFs`.
//
// Two invariants this module enforces:
//  - every node path handed to `sidecarPathFor` must live under `base` (real
//    usage: `base` is the project root, every root/node resolved under it) —
//    violating this is a programming error, not a data error, so it throws;
//  - the sidecar record is decoded LENIENTLY: unknown keys are ignored rather
//    than rejected, so a future, richer sidecar (e.g. #29's per-instance
//    manifests) still reads on an older binary that only knows `sha256`/`version`
//    — the whole point of moving tracking data out of content is to let it grow
//    without ever touching a content file, and a schema that breaks forward
//    compatibility would defeat that.

import * as nodePath from 'node:path'

import { Result, Schema } from 'effect'

// POSIX path semantics so sidecar paths are identical on every OS, matching
// SummaryTree.ts's own rationale for the same choice.
const path = nodePath.posix

/** The hidden directory name every metadata tree lives under, relative to `base`. */
export const META_DIR = '.cairn'

export interface StampRecord {
  readonly sha256: string
  readonly version: number
}

/** Bumped only if the sidecar's own shape changes incompatibly (never for adding
 * an optional field — `decodeStamp` already tolerates unknown keys). */
export const STAMP_VERSION = 1

const StampRecordSchema = Schema.Struct({
  sha256: Schema.String,
  version: Schema.Number,
})

const decodeStamp = Schema.decodeUnknownResult(StampRecordSchema)

/** The sidecar's on-disk JSON form. Trailing newline for a clean git diff. */
export const serializeStamp = (record: StampRecord): string => `${JSON.stringify(record, null, 2)}\n`

/**
 * Read a sidecar's `StampRecord` back, or `null` if it's missing/corrupt/
 * malformed/hand-edited/merge-conflicted — this must NEVER throw. A stamp that
 * can't be trusted is exactly equivalent to no stamp: the node it covers reads
 * as stale, not as a crash (see AGENTS.md's note on treating an unparsable
 * stamp the same as a missing one).
 */
export const parseStamp = (content: string): StampRecord | null => {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    return null
  }
  const decoded = decodeStamp(json)
  return Result.isSuccess(decoded) ? decoded.success : null
}

export interface MetaLayout {
  /** The project root every node path and every sidecar is resolved under. */
  readonly base: string
  /** `join(base, META_DIR)` — passed explicitly (not recomputed) so callers who
   * already have it (e.g. after listing `.cairn/**`) don't rederive it. */
  readonly metaRoot: string
}

export const metaRootFor = (base: string): string => path.join(base, META_DIR)

/** True for any path inside the hidden metadata tree — used to keep `.cairn/**`
 * out of the set of markdown source files a plan considers. */
export const isSidecarPath = (candidate: string, metaRoot: string): boolean =>
  candidate === metaRoot || candidate.startsWith(`${metaRoot}/`)

/**
 * `<base>/docs/a.summary.md` -> `<metaRoot>/docs/a.summary.md.json`. Throws if
 * `nodeAtPath` isn't under `base` — every real node path is (roots are always
 * resolved under the project root before a plan ever runs), so this signals a
 * caller bug, not a runtime data condition to recover from.
 */
export const sidecarPathFor = (nodeAtPath: string, layout: MetaLayout): string => {
  const rel = path.relative(layout.base, nodeAtPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`sidecarPathFor: "${nodeAtPath}" is not under base "${layout.base}"`)
  }
  return `${path.join(layout.metaRoot, rel)}.json`
}

/**
 * The inverse of `sidecarPathFor`: given a sidecar's own path (e.g. found by
 * listing `.cairn/**`), recover the node path it mirrors. Returns `null` for a
 * path that isn't a well-formed sidecar under `metaRoot` (not `.json`, or
 * outside the tree) rather than throwing — unlike `sidecarPathFor`, this reads
 * data that could plausibly be malformed (a stray non-JSON file dropped into
 * `.cairn/` by hand), so `null` is the right "not a sidecar" signal, not a crash.
 */
export const nodePathForSidecar = (sidecarPath: string, layout: MetaLayout): string | null => {
  if (!isSidecarPath(sidecarPath, layout.metaRoot) || !sidecarPath.endsWith('.json')) {
    return null
  }
  const rel = path.relative(layout.metaRoot, sidecarPath)
  if (rel.startsWith('..')) {
    return null
  }
  return path.join(layout.base, rel.slice(0, -'.json'.length))
}
