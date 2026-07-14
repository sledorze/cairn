// Pure, IO-free helpers for the "big files carry a fresher .summary.md" rule.
// Convention: a Markdown file of more than `thresholdLines` lines must have a
// sibling `X<suffix>` (default `X.summary.md`) that reflects the CURRENT content
// of `X.md` — a faster-to-read version kept in sync.
//
// Freshness is enforced by a content hash, NOT by filesystem mtime: git does not
// preserve mtimes, so after a clone/checkout (e.g. in CI) every file shares the
// same timestamp and a time-based check silently passes on stale summaries.
// Each summary embeds `<!-- source-sha256: ... -->`; the checker recomputes the
// source hash and flags any mismatch. Deterministic and clone-independent.
//
// Naming (directory-summary filename, file-summary suffix) is configurable; the
// defaults below reproduce the original behaviour. Unit-tested in
// DocSummaries.unit.test.ts; the Effect program is in ../program/CheckSummaries.ts.

import { hash as hashHex } from 'node:crypto'

export type SummaryStatus = 'missing' | 'ok' | 'stale'

/** Configurable filenames for the summary system. */
export interface Naming {
  /** Per-directory digest filename, e.g. `_SUMMARY.md`. */
  readonly dirSummary: string
  /** Sibling file-summary suffix, e.g. `.summary.md` (`foo.md` -> `foo.summary.md`). */
  readonly fileSummarySuffix: string
}

/** Defaults matching the original hard-coded convention. */
export const DEFAULT_NAMING: Naming = {
  dirSummary: '_SUMMARY.md',
  fileSummarySuffix: '.summary.md',
}

export interface NeedsSummaryArgs {
  readonly lineCount: number
  readonly naming?: Naming
  readonly path: string
  readonly thresholdLines: number
}

export interface ClassifyArgs {
  readonly recordedHash: string | null
  readonly sourceHash: string
  readonly summaryExists: boolean
}

/** A Markdown file with more lines than this must carry a summary. */
export const DEFAULT_THRESHOLD_LINES = 30

const HASH_RE = /<!--\s*source-sha256:\s*([a-f0-9]{64})\s*-->/

/** Count lines, ignoring a single trailing newline. */
export const countLines = (content: string): number => {
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines.length
}

/** True for the generated summary files themselves. */
export const isSummaryFile = (path: string, naming: Naming = DEFAULT_NAMING): boolean =>
  path.endsWith(naming.fileSummarySuffix)

/** `docs/a/foo.md` -> `docs/a/foo.summary.md` (suffix configurable). */
export const summaryPathFor = (path: string, naming: Naming = DEFAULT_NAMING): string =>
  path.replace(/\.md$/, naming.fileSummarySuffix)

/** A non-summary Markdown file longer than the threshold must have a summary. */
export const needsSummary = ({
  lineCount,
  naming = DEFAULT_NAMING,
  path,
  thresholdLines,
}: NeedsSummaryArgs): boolean => {
  if (!path.endsWith('.md')) {
    return false
  }
  if (isSummaryFile(path, naming)) {
    return false
  }
  return lineCount > thresholdLines
}

// One-shot `crypto.hash` (Node >=20.12) skips the streaming Hash object's
// internal state entirely — faster than `createHash().update().digest()` for
// the KB-sized markdown content this hashes, at the scale this runs at (once
// per file/manifest per plan).
/** Deterministic content hash used to stamp and verify summaries. */
export const hashContent = (content: string): string => hashHex('sha256', content, 'hex')

/** The HTML-comment stamp a summary must carry to declare which source it reflects. */
export const sourceHashTag = (hash: string): string => `<!-- source-sha256: ${hash} -->`

/** Read back the source hash recorded in a summary, or null if absent. */
export const extractSourceHash = (summaryContent: string): string | null => HASH_RE.exec(summaryContent)?.[1] ?? null

/** Return the summary content stamped with `hash` (replacing any existing stamp). */
export const withSourceHash = (summaryContent: string, hash: string): string => {
  const tag = sourceHashTag(hash)
  if (HASH_RE.test(summaryContent)) {
    return summaryContent.replace(HASH_RE, tag)
  }
  return `${tag}\n\n${summaryContent}`
}

/** Classify a summary: missing, stale (hash absent or mismatched) or ok. */
export const classifySummary = ({ recordedHash, sourceHash, summaryExists }: ClassifyArgs): SummaryStatus => {
  if (!summaryExists) {
    return 'missing'
  }
  if (recordedHash !== sourceHash) {
    return 'stale'
  }
  return 'ok'
}
