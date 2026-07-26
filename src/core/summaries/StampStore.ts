// The hidden, hierarchy-mirroring metadata tree that replaces the in-content
// `<!-- source-sha256: H -->` stamp (see AGENTS.md / issue #35). Every
// summarizable node keeps its authored prose stamp-free; instead, a sidecar
// JSON file under `<base>/.cairn/` mirrors the node's path 1:1 and carries the
// freshness hash. This module is pure (no IO): the `StampRecord` shape only.
// `../../program/summaries/CheckSummaries.ts` is the impure edge that reads/
// writes sidecars via `DocsFs`.
//
// Path mapping and the lenient-decode codec mechanics live in `../sidecar.ts`
// — genuinely shared with `../links/RefStore.ts` (both are `.cairn/**`
// sidecars), kept out of this file so it stays about ONE thing: what a
// summary-freshness record actually contains.

import { Schema } from 'effect'

import { makeSidecarCodec } from '../sidecar.ts'

export interface StampRecord {
  readonly sha256: string
  readonly version: number
}

/** Bumped only if the sidecar's own shape changes incompatibly (never for adding
 * an optional field — the codec already tolerates unknown keys, forward-compatible
 * with a future, richer sidecar). */
export const STAMP_VERSION = 1

const StampRecordSchema = Schema.Struct({
  sha256: Schema.String,
  version: Schema.Number,
})

const stampCodec = makeSidecarCodec(StampRecordSchema)

/** The sidecar's on-disk JSON form. Trailing newline for a clean git diff. */
export const serializeStamp: (record: StampRecord) => string = stampCodec.serialize

/**
 * Read a sidecar's `StampRecord` back, or `null` if it's missing/corrupt/
 * malformed/hand-edited/merge-conflicted — this must NEVER throw. A stamp that
 * can't be trusted is exactly equivalent to no stamp: the node it covers reads
 * as stale, not as a crash (see AGENTS.md's note on treating an unparsable
 * stamp the same as a missing one).
 */
export const parseStamp: (content: string) => StampRecord | null = stampCodec.parse
