// Impure edge for issue #155's version-change notice: reads/writes the
// single, repo-level `.cairn/version.json` sidecar via `DocsFs`. Decision
// logic (`core/VersionNotice.ts`) is pure; this file is the IO wiring only —
// same split as `core/summaries/StampStore.ts` (pure) / `CheckSummaries.ts`
// (impure edge).
//
// Deliberately a SINGLE global file, not one sidecar per doc like every
// other `.cairn/**` record: "which cairn version last touched this repo" is
// a fact about the repo as a whole, not about any one file.

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import { parseVersionRecord, serializeVersionRecord, versionNoticeFor } from '../core/VersionNotice.ts'
import { metaRootFor } from '../core/sidecar.ts'
import { DocsFs } from '../io/DocsFs.ts'

const path = nodePath.posix

const versionSidecarPath = (base: string): string => path.join(metaRootFor(base), 'version.json')

export interface VersionNoticeArgs {
  readonly base: string
  readonly runningVersion: string
}

/**
 * Read-only: never writes. A plain `cairn check` (no `--stamp`) calls this
 * every run, exactly like it re-reads every other `.cairn/**` sidecar to
 * report drift — the notice itself repeats on every run until the next
 * `--stamp` silences it (see `stampVersionNotice` below), matching this
 * repo's own "the tool only verifies and stamps" convention: nothing here
 * mutates the filesystem outside an explicit `--stamp`.
 */
export const checkVersionNotice = ({
  base,
  runningVersion,
}: VersionNoticeArgs): Effect.Effect<string | null, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const sidecarPath = versionSidecarPath(base)
    const sidecarExists = yield* dfs.exists(sidecarPath)
    if (!sidecarExists) {
      return versionNoticeFor(null, runningVersion)
    }
    // Same "unreadable/corrupt reads as absent, never a crash" contract as
    // every other sidecar read in this codebase (e.g. `CheckRefs.ts`'s own
    // `sidecarContent` read).
    const content = yield* dfs.readFile(sidecarPath).pipe(Effect.catchDefect(() => Effect.succeed(null)))
    const recorded = content === null ? null : parseVersionRecord(content)
    return versionNoticeFor(recorded?.version ?? null, runningVersion)
  })

/**
 * Writes the CURRENT running version to the sidecar. Called only from
 * `--stamp` (any stamp mode: bare `--stamp`, `--summaries-only --stamp`,
 * `--refs --stamp`, `--migrate-stamps`) — the one thing every other
 * `.cairn/**` sidecar's write already requires, so this stays consistent
 * with all of them rather than auto-writing on a bare `check`.
 */
export const stampVersionNotice = ({ base, runningVersion }: VersionNoticeArgs): Effect.Effect<void, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    yield* dfs.writeFile(versionSidecarPath(base), serializeVersionRecord({ version: runningVersion }))
  })
