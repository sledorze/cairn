// Issue #155: every feature cairn ships as a config key or a Markdown
// convention (`checks.coverage.kinds`, `refs.scope`, `checks.proseRefs.ignore`,
// `cairn-refs` fenced blocks, ...) is deliberately invisible in `--help` —
// that's correct design (no new CLI surface for something a config file
// already expresses), but it also means `--help` is precisely the wrong place
// to learn what changed, and it's the first place anyone looks. The package's
// own `CHANGELOG.md` is genuinely excellent and ships in the tarball (issue
// #134) — nothing routes a reader to it. Two independent real upgrades hit
// this (0.9→0.10 in issue #155 itself; 0.6.0→0.13.2, a much larger jump, in
// its own follow-up comment).
//
// This module is pure (no IO): the sidecar record shape and the notice
// decision only. `../cli.ts` is the impure edge that reads/writes the sidecar
// via `DocsFs` and prints the notice — same split as `summaries/StampStore.ts`.

import { Schema } from 'effect'

import { makeSidecarCodec } from './sidecar.ts'

export interface VersionRecord {
  readonly version: string
}

const VersionRecordSchema = Schema.Struct({
  version: Schema.String,
})

const versionCodec = makeSidecarCodec(VersionRecordSchema)

/** The sidecar's on-disk JSON form. Trailing newline for a clean git diff. */
export const serializeVersionRecord: (record: VersionRecord) => string = versionCodec.serialize

/**
 * Read a sidecar's `VersionRecord` back, or `null` if it's missing/corrupt/
 * malformed/hand-edited/merge-conflicted — same "unparsable reads as absent,
 * never a crash" contract as `parseStamp`/`parseRefs`.
 */
export const parseVersionRecord: (content: string) => VersionRecord | null = versionCodec.parse

/**
 * `null` (nothing recorded — a repo's very first `cairn check --stamp` ever,
 * or a corrupt/hand-edited sidecar) never shows a notice: there's no prior
 * version to compare against, and printing "cairn ??? → X.Y.Z" on someone's
 * first run would be pure noise, not an upgrade signal — silently records the
 * current version instead (the caller's job, not this function's). Identical
 * to `running` means nothing changed since the last stamp; only a genuine
 * MISMATCH is actionable, matching this repo's own "actionable-only, once,
 * silent afterwards" discipline (the `--refs` kind-guidance tip, `CheckRefs.ts`).
 */
export const versionNoticeFor = (recorded: string | null, running: string): string | null =>
  recorded === null || recorded === running ? null : `cairn ${recorded} → ${running}`
