// Git-tracking capability (issue #48): `onlyGitTracked` needs to know which files
// `git` itself considers part of the repo (tracked or staged) — a genuinely
// different filtering dimension than a glob, since no glob pattern can express
// "and also check the index." This is real IO (shells out to the `git` binary),
// so it lives beside `DocsFs.ts` in `io/`, not `core/`.

import { execFile } from 'node:child_process'
import * as nodePath from 'node:path'

import { Context, Data, Effect, Layer } from 'effect'

import { toPosix } from '../core/paths.ts'

/**
 * `onlyGitTracked` has exactly one named failure mode, deliberately: a hard
 * error, never a silent fallback to "scan everything" or "scan nothing" —
 * either would let someone believe git-filtering is active when it isn't
 * (issue #48, acceptance criterion 4). Callers decide how to surface it;
 * this module only ever fails this one way.
 */
export class GitUnavailableError extends Data.TaggedError('GitUnavailableError')<{
  readonly base: string
  readonly message: string
}> {}

export interface GitFsService {
  /**
   * Every path `git` currently has in its index at `base` — tracked files
   * AND staged-but-uncommitted ones (plain `git ls-files`, no extra flags:
   * the closest available proxy to "would a fresh commit include this,"
   * which is what CI parity actually needs — not worktree-only, not
   * committed-only). Returns absolute, POSIX-normalised paths, matching
   * every other path this codebase compares against (`DocsFs.listFiles`,
   * `isWithinBase`).
   */
  readonly listTrackedFiles: (base: string) => Effect.Effect<ReadonlySet<string>, GitUnavailableError>
}

export class GitFs extends Context.Service<GitFs, GitFsService>()('GitFs') {}

const runLsFiles = (base: string): Effect.Effect<string, GitUnavailableError> =>
  Effect.tryPromise({
    // `-z`: NUL-separated output — the only safe way to enumerate paths that
    // may themselves contain newlines. `maxBuffer` raised well past Node's
    // 1 MiB default: a large monorepo's tracked-file list can legitimately
    // exceed that.
    catch: (cause) =>
      new GitUnavailableError({
        base,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    try: () =>
      new Promise<string>((resolve, reject) => {
        execFile('git', ['-C', base, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr.trim().length > 0 ? stderr.trim() : error.message))
            return
          }
          resolve(stdout)
        })
      }),
  })

const toAbsPosix = (base: string, relOrAbs: string): string =>
  toPosix(nodePath.isAbsolute(relOrAbs) ? relOrAbs : nodePath.join(base, relOrAbs))

/** Live implementation: shells out to the real `git` binary. */
export const GitFsLive = Layer.succeed(GitFs, {
  listTrackedFiles: (base) =>
    runLsFiles(base).pipe(
      Effect.map((stdout) => {
        const paths = stdout.split('\0').filter((entry) => entry.length > 0)
        return new Set(paths.map((rel) => toAbsPosix(base, rel)))
      }),
    ),
})

/** In-memory GitFs layer for tests — `tracked` is the already-absolute-POSIX set to report. */
export const makeTestGitFs = (tracked: ReadonlySet<string> | GitUnavailableError): Layer.Layer<GitFs> =>
  Layer.succeed(GitFs, {
    listTrackedFiles: () => (tracked instanceof GitUnavailableError ? Effect.fail(tracked) : Effect.succeed(tracked)),
  })
