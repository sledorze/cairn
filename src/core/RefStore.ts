// Sidecar tracking for issue #39 Scenario I ("this doc's claim about a
// referenced target may be stale, even though the link isn't broken"):
// records the content hash of each real reference (a cross-file/cross-
// hierarchy link target) a doc makes, at stamp time, so a LATER change to
// the target's content — the target still exists, the link still resolves —
// can be surfaced as drift, distinct from `MarkdownLinks.ts`'s "broken."
//
// Own path namespace, `.cairn/refs/**` — NOT `StampStore.ts`'s
// `sidecarPathFor` applied directly to the doc's path. That was the first
// design (reasoning: `docs/architecture.md` never had a sidecar of its own,
// so `.cairn/docs/architecture.md.json` looked free) — wrong in general and
// caught by construction while dogfooding: `docs/_SUMMARY.md` is ALSO a real
// `.md` file `stampRefs` scans (it links to every child doc, including
// `architecture.md`), and its OWN freshness sidecar already lives at exactly
// `.cairn/docs/_SUMMARY.md.json` — writing a refs record there silently
// clobbered it. Every summary-tree node (`X.summary.md`, `_SUMMARY.md`) is
// simultaneously a scannable doc, so the two concerns need genuinely
// disjoint path spaces, not "usually disjoint."
//
// Deliberately a SEPARATE record shape from `StampStore.ts`'s `StampRecord`,
// not a shared one: a source doc's sidecar has no summary-freshness hash to
// carry, and a summary's sidecar (today) carries no references — forcing
// one schema to serve both would leave one half always meaningless for any
// given sidecar. Same lenient-decode philosophy as `StampStore.ts`: unknown
// keys are ignored, and a corrupt/hand-edited sidecar reads as absent, never
// throws.

import * as nodePath from 'node:path'

import { Result, Schema } from 'effect'

import type { MetaLayout } from './StampStore.ts'

const path = nodePath.posix

/** The subdirectory, under `metaRoot`, every reference sidecar lives under —
 * disjoint from the summary-freshness sidecars living directly under
 * `metaRoot` (see module header: this is load-bearing, not stylistic). */
export const REFS_DIR = 'refs'

export interface RefRecord {
  readonly anchor?: string
  readonly hash: string
  readonly target: string
}

export interface RefsRecord {
  readonly refs: readonly RefRecord[]
}

/** Bumped only if this shape changes incompatibly (never for adding an
 * optional field — `parseRefs` already tolerates unknown keys). */
export const REFS_VERSION = 1

const RefRecordSchema = Schema.Struct({
  anchor: Schema.optionalKey(Schema.String),
  hash: Schema.String,
  target: Schema.String,
})

const RefsRecordSchema = Schema.Struct({
  refs: Schema.Array(RefRecordSchema),
})

const decodeRefs = Schema.decodeUnknownResult(RefsRecordSchema)

/** The sidecar's on-disk JSON form. Trailing newline for a clean git diff. */
export const serializeRefs = (record: RefsRecord): string => `${JSON.stringify(record, null, 2)}\n`

/**
 * Read a sidecar's `RefsRecord` back, or `null` if it's missing/corrupt/
 * malformed/hand-edited/merge-conflicted — this must NEVER throw, mirroring
 * `StampStore.ts`'s `parseStamp`: an untrustworthy record reads as no
 * recorded references at all, not a crash.
 */
export const parseRefs = (content: string): RefsRecord | null => {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    return null
  }
  const decoded = decodeRefs(json)
  return Result.isSuccess(decoded) ? decoded.success : null
}

/**
 * `<base>/docs/architecture.md` -> `<metaRoot>/refs/docs/architecture.md.json`.
 * Throws if `docAtPath` isn't under `base`, mirroring `sidecarPathFor`'s own
 * rule (a caller bug, not a runtime data condition).
 */
export const refsSidecarPathFor = (docAtPath: string, layout: MetaLayout): string => {
  const rel = path.relative(layout.base, docAtPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refsSidecarPathFor: "${docAtPath}" is not under base "${layout.base}"`)
  }
  return `${path.join(layout.metaRoot, REFS_DIR, rel)}.json`
}
