// Git-tracking capability (issue #48): `onlyGitTracked` needs to know which files
// `git` itself considers part of the repo (tracked or staged) — a genuinely
// different filtering dimension than a glob, since no glob pattern can express
// "and also check the index." This is real IO (shells out to the `git` binary),
// so it lives beside `DocsFs.ts` in `io/`, not `core/`.

import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'

import { Context, Data, Effect, Layer, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import { toPosix } from '../core/paths.ts'
import { scrubbedGitEnv } from './gitEnv.ts'

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
  /**
   * Every WHOLLY-gitignored directory under `base`, as `git` itself sees it
   * — `git ls-files --others --ignored --exclude-standard --directory`,
   * which reports a fully-ignored directory as ONE collapsed entry rather
   * than descending into it (so this command is itself cheap even against a
   * huge ignored `node_modules` — git never walks in either). Issue #63:
   * used to prune `DocsFs.listFiles`'s walk before it ever recurses into a
   * gitignored directory, independent of whether `onlyGitTracked` is on —
   * this is an always-on default, not an opt-in guarantee, so unlike
   * `listTrackedFiles` its caller is expected to fall back to "no
   * gitignore-based pruning" rather than hard-fail when git is unavailable.
   * Returns absolute, POSIX-normalised, trailing-slash-free directory
   * paths. A standalone gitignored FILE (not inside an ignored directory)
   * is deliberately NOT reported here — this method is scoped to
   * DIRECTORY-level pruning only, matching the granularity
   * `DocsFs.listFiles`'s `ignore` parameter already prunes at; a real,
   * separate follow-up, not silently glossed over.
   */
  readonly listIgnoredDirs: (base: string) => Effect.Effect<readonly string[], GitUnavailableError>
  /**
   * Every OTHER worktree directory of the repo at `base` (`git worktree
   * list --porcelain`), excluding `base` itself — regardless of whether
   * `base` happens to be the primary worktree or itself a linked one (`git
   * worktree list` always lists the primary first, which is a different
   * thing from `base`; naively dropping "whichever entry comes first"
   * instead of filtering by equality to `base` leaves `base` itself in a
   * caller's ignore list when `base` isn't the primary — confirmed as a
   * real bug via dogfooding a multi-worktree dev setup).
   * A linked worktree — e.g. `.claude/worktrees/<name>`, created by an
   * agent to work on a branch in isolation — nests a full second copy of
   * the repo's own doc tree inside the primary one. Walking it doubles
   * every summary/link finding, and if it has its own real `node_modules`
   * checked out, reintroduces the exact issue #63 OOM shape one directory
   * deeper. Returns absolute, POSIX-normalised, trailing-slash-free
   * directory paths, matching `listIgnoredDirs`'s contract exactly so both
   * feed the same `ignore`-pruning path in `DocsFs.listFiles`.
   */
  readonly listWorktreeDirs: (base: string) => Effect.Effect<readonly string[], GitUnavailableError>
}

export class GitFs extends Context.Service<GitFs, GitFsService>()('GitFs') {}

/**
 * Runs `git -C base <args>` via `effect`'s own `ChildProcess`/`ChildProcessSpawner`
 * (`effect/unstable/process`) rather than raw `node:child_process` — the idiomatic
 * way to shell out in an Effect codebase: a typed `PlatformError`/exit-code contract,
 * and env scrubbing (`scrubbedGitEnv`) expressed as a plain `Command` option instead
 * of hand-wired into a `new Promise((resolve, reject) => execFile(...))` callback.
 * `-C base` stays authoritative because `scrubbedGitEnv(base)` strips every GIT_*
 * variable that could otherwise override it, and additionally sets
 * `GIT_CEILING_DIRECTORIES` so discovery can never escape past `base` to a
 * differently-rooted ancestor repository (see `gitEnv.ts`).
 *
 * Requires `ChildProcessSpawner` in its environment — deliberately not baked into
 * this module's own `GitFsLive`, matching the same pattern `DocsFsLive` already
 * establishes in this codebase: the live Node implementation is provided once by
 * the caller (`src/cli.ts` already does, via `NodeServices.layer`, for `DocsFsLive`),
 * not smuggled into the service itself.
 */
const runGit = (
  base: string,
  args: readonly string[],
): Effect.Effect<string, GitUnavailableError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const command = ChildProcess.make('git', ['-C', base, ...args], { env: scrubbedGitEnv(base) })
      const handle = yield* spawner.spawn(command)
      const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout))
      const stderr = yield* Stream.mkString(Stream.decodeText(handle.stderr))
      const exitCode = yield* handle.exitCode
      if (Number(exitCode) !== 0) {
        return yield* Effect.fail(
          new GitUnavailableError({
            base,
            message: stderr.trim().length > 0 ? stderr.trim() : `git exited with code ${exitCode}`,
          }),
        )
      }
      return stdout
    }),
  ).pipe(
    // `PlatformError` (spawn/stream/exit-code failures) is a `Data.TaggedError` with
    // `_tag: "PlatformError"` — `catchTag` narrows to exactly that case and leaves an
    // already-thrown `GitUnavailableError` (from the exit-code check above) untouched,
    // using Effect's own tagged-error discrimination instead of a runtime `instanceof`.
    Effect.catchTag('PlatformError', (error) => Effect.fail(new GitUnavailableError({ base, message: error.message }))),
  )

const toAbsPosix = (base: string, relOrAbs: string): string =>
  toPosix(nodePath.isAbsolute(relOrAbs) ? relOrAbs : nodePath.join(base, relOrAbs))

/** Resolves symlinks (e.g. a `base` reached through a symlinked `/tmp`, common on
 * macOS where it points at `/private/tmp`) so path-equality comparisons aren't fooled
 * by two different-looking paths that name the same directory. `git worktree list`
 * reports its own realpath-resolved form regardless of the literal path a worktree was
 * created through — confirmed empirically: creating a worktree via a symlinked path
 * still gets reported under the symlink's target. Falls back to the original path if
 * it doesn't exist (or `realpath` fails for any other reason) rather than throwing —
 * this is a best-effort comparison aid, not a correctness-critical resolution. */
const realpathOrSelf = (p: string): string => {
  try {
    return nodeFs.realpathSync(p)
  } catch {
    return p
  }
}

/** Live implementation: shells out to the real `git` binary. Requires
 * `ChildProcessSpawner` — provide the Node implementation alongside this layer
 * (e.g. `Effect.provide(GitFsLive), Effect.provide(NodeServices.layer)`, as
 * `src/cli.ts` already does). */
export const GitFsLive = Layer.effect(
  GitFs,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return GitFs.of({
      listIgnoredDirs: (base) =>
        Effect.provideService(
          runGit(base, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']),
          ChildProcessSpawner.ChildProcessSpawner,
          spawner,
        ).pipe(
          Effect.map((stdout) =>
            stdout
              .split('\0')
              .filter((entry) => entry.endsWith('/'))
              .map((rel) => toAbsPosix(base, rel.slice(0, -1))),
          ),
        ),
      listTrackedFiles: (base) =>
        Effect.provideService(runGit(base, ['ls-files', '-z']), ChildProcessSpawner.ChildProcessSpawner, spawner).pipe(
          Effect.map((stdout) => {
            const paths = stdout.split('\0').filter((entry) => entry.length > 0)
            return new Set(paths.map((rel) => toAbsPosix(base, rel)))
          }),
        ),
      listWorktreeDirs: (base) =>
        Effect.provideService(
          runGit(base, ['worktree', 'list', '--porcelain']),
          ChildProcessSpawner.ChildProcessSpawner,
          spawner,
        ).pipe(
          Effect.map((stdout) => {
            // `--porcelain` emits one `worktree <path>` line per worktree, the
            // PRIMARY worktree always first — not necessarily `base` itself.
            // Bug found by dogfooding this repo's own multi-worktree dev setup:
            // when `base` is a linked (non-primary) worktree, blindly dropping
            // "whichever entry comes first" leaves `base` itself in the
            // result, which callers (`cli.ts`) then add to `ignore` as
            // `${base}/**` — silently excluding the ENTIRE scan root. Filter
            // by equality to `base`, not by position — and by realpath, not
            // literal string equality: `git worktree list` always reports its
            // own realpath-resolved form, so a `base` reached through a
            // symlink (e.g. macOS's `/tmp` -> `/private/tmp`) would otherwise
            // still leak through under its resolved name, reproducing the
            // exact same bug for symlinked paths specifically (confirmed
            // empirically, its own regression test below).
            const baseReal = toPosix(realpathOrSelf(base))
            const paths = stdout
              .split('\n')
              .filter((line) => line.startsWith('worktree '))
              .map((line) => line.slice('worktree '.length).trim())
              .map((p) => toAbsPosix(base, p))
            return paths.filter((p) => toPosix(realpathOrSelf(p)) !== baseReal)
          }),
        ),
    })
  }),
)

/** In-memory GitFs layer for tests — `tracked`/`ignoredDirs` are the
 * already-absolute-POSIX values to report; each independently accepts a
 * `GitUnavailableError` since a real caller can have git available for one
 * call and not the other (e.g. a corrupt index affects `ls-files` output
 * generally, but the two commands are still independent failure surfaces
 * worth testing separately). */
export const makeTestGitFs = (
  tracked: ReadonlySet<string> | GitUnavailableError,
  ignoredDirs: readonly string[] | GitUnavailableError = [],
  worktreeDirs: readonly string[] | GitUnavailableError = [],
): Layer.Layer<GitFs> =>
  Layer.succeed(GitFs, {
    listIgnoredDirs: () =>
      ignoredDirs instanceof GitUnavailableError ? Effect.fail(ignoredDirs) : Effect.succeed(ignoredDirs),
    listTrackedFiles: () => (tracked instanceof GitUnavailableError ? Effect.fail(tracked) : Effect.succeed(tracked)),
    listWorktreeDirs: () =>
      worktreeDirs instanceof GitUnavailableError ? Effect.fail(worktreeDirs) : Effect.succeed(worktreeDirs),
  })
