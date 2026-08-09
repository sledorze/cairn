// Git-tracking capability (issue #48): `onlyGitTracked` needs to know which files
// `git` itself considers part of the repo (tracked or staged) — a genuinely
// different filtering dimension than a glob, since no glob pattern can express
// "and also check the index." This is real IO (shells out to the `git` binary),
// so it lives beside `DocsFs.ts` in `io/`, not `core/`.

import * as nodePath from 'node:path'

import { Context, Data, Effect, FileSystem, Layer, Stream } from 'effect'
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
   * real bug via dogfooding a multi-worktree dev setup) — AND excluding
   * every worktree that is an ANCESTOR of `base` on disk, not just equal to
   * it: a linked worktree nested inside another worktree's own directory
   * (e.g. `<primary>/.claude/worktrees/<name>`) means the ancestor's
   * reported path is a PREFIX of `base`'s, so a caller turning it into
   * `${ancestor}/**` would also match every file under `base` — the same
   * "0 files, all clean" failure as the equality case, via a different
   * path shape (a real, reported bug: confirmed with just 2 worktrees).
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
  /**
   * Every path present at `ref` that's gone from the CURRENT working tree
   * (`git diff --name-status --diff-filter=D -z <ref>`, one-sided — `ref`
   * compared against the worktree, staged or not, exactly like `git diff
   * <ref>` on its own) — issue #106's actual detection surface. Comparing
   * against `HEAD` catches an uncommitted `rm`, run as a pre-commit hook;
   * comparing against a PR's base branch (e.g. `origin/main`) catches every
   * deletion the PR itself introduces, including ones already committed —
   * the real reported scenario ("deleted a doc, only noticed hours later").
   * Returns absolute, POSIX-normalised paths.
   */
  readonly listDeletedSince: (base: string, ref: string) => Effect.Effect<readonly string[], GitUnavailableError>
  /**
   * `git show <ref>:<path>` — the content `path` (absolute, resolved
   * relative to `base`) carried at `ref` (issue #106: reading a deleted
   * doc's last-known content so `--report-deletions` has something to
   * extract headings/links from). Meant to be called only for a path
   * `listDeletedSince` already reported present at that exact `ref` — by
   * that method's own diff-based contract, such a path always genuinely
   * existed there, so a failure here is a real problem (a corrupt object,
   * an invalid `ref`), not a benign absence. Propagates `GitUnavailableError`
   * rather than swallowing it into `null` — a caller-supplied `ref` (e.g.
   * `--deletions-since` from CI config) failing silently would be exactly
   * the "believe it's working when it isn't" failure mode `onlyGitTracked`'s
   * own `GitUnavailableError` contract elsewhere in this file exists to
   * prevent (found via adversarial review: the original `null`-on-any-
   * failure version conflated "not at this ref" with a genuinely corrupt
   * git object, confirmed by reproducing the latter directly).
   */
  readonly readFileAtRef: (base: string, ref: string, absPath: string) => Effect.Effect<string, GitUnavailableError>
  /**
   * The committer date (`git log -1 --format=%cI -- <path>`, ISO 8601 strict)
   * of the most recent commit that touched `absPath` (absolute, resolved
   * relative to `base`) — issue tracked in `docs/design/CONVENTION.md`'s
   * "freshness/staleness rules" gap: `checks.freshness`'s own "how old is
   * this doc, really" question. Deliberately git's own committer date, NOT
   * filesystem mtime: a fresh `git clone`/CI checkout resets every file's
   * mtime to checkout time regardless of the doc's real history, which
   * would make every doc look brand-new the moment CI runs — exactly the
   * silent-wrong-answer failure mode this whole method exists to avoid.
   * Returns `null` when `path` has no commit history at all yet (`git log`
   * exits 0 with empty output for a real, existing-but-uncommitted path) —
   * a legitimately different case from `GitUnavailableError` (git itself
   * failing), not conflated with it: a brand-new doc has nothing to measure
   * an age from, which isn't the same as git being broken.
   */
  readonly lastCommitDate: (base: string, absPath: string) => Effect.Effect<Date | null, GitUnavailableError>
  /**
   * Every commit SHA that touched `absPath`, newest-first (`git log
   * --format=%H -- <path>`) — issue #142/#154's "show what actually
   * changed, not just that the hash differs" gap: cairn's own recorded hash
   * is our sha256, not any git object id, so there is no direct git lookup
   * from "this content hash" to "which commit produced it"; a caller walks
   * this list, re-hashing `readFileAtRef` at each SHA with `hashContent`,
   * until a match or the caller's own bound is hit. Returns `[]` when `path`
   * has no commit history yet — the same "no history, not an error"
   * contract `lastCommitDate` already establishes, not conflated with
   * `GitUnavailableError`.
   */
  readonly historyForPath: (base: string, absPath: string) => Effect.Effect<readonly string[], GitUnavailableError>
  /**
   * Line-count delta for `absPath` between `ref` and the current working
   * tree (`git diff --numstat <ref> -- <path>`) — issue #142/#154's own
   * "reflexive re-stamping" gap: a bare hash mismatch says nothing about
   * WHAT changed, so a human/agent re-stamps without looking. `null` for a
   * binary file (git reports `-\t-` for `added`/`removed` — unrepresentable
   * as a line count, deliberately not coerced to `0/0`, which would read as
   * "no change") or when `ref`/`path` doesn't resolve to a comparable diff.
   * `{added: 0, removed: 0}` is a real, valid answer (content identical at
   * both ends) — distinct from `null`, never conflated.
   */
  readonly diffStat: (
    base: string,
    ref: string,
    absPath: string,
  ) => Effect.Effect<{ readonly added: number; readonly removed: number } | null, GitUnavailableError>
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

/** Decode-at-the-boundary for one `--numstat` field: `null` for anything that
 * isn't a plain non-negative integer (git's literal `-` for a binary file,
 * or any other unexpected shape) — never a raw `Number()` coercion, which
 * would silently turn `-` into `NaN` instead of a caller-visible failure. */
const parseDigits = (raw: string | undefined): number | null => {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return null
  }
  // Digit-by-digit, not `Number(...)`/`parseInt` — the regex above is the
  // decode-at-the-boundary check that can fail; this arithmetic can't.
  return [...raw].reduce((acc, digit) => acc * 10 + (digit.codePointAt(0) ?? 48) - 48, 0)
}

const toAbsPosix = (base: string, relOrAbs: string): string =>
  toPosix(nodePath.isAbsolute(relOrAbs) ? relOrAbs : nodePath.join(base, relOrAbs))

/** Live implementation: shells out to the real `git` binary. Requires
 * `ChildProcessSpawner` and `FileSystem.FileSystem` — provide the Node
 * implementations alongside this layer (e.g. `Effect.provide(GitFsLive),
 * Effect.provide(NodeServices.layer)`, as `src/cli.ts` already does). */
export const GitFsLive = Layer.effect(
  GitFs,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem
    /** Resolves symlinks (e.g. a `base` reached through a symlinked `/tmp`,
     * common on macOS where it points at `/private/tmp`) so path-equality
     * comparisons aren't fooled by two different-looking paths that name the
     * same directory. `git worktree list` reports its own realpath-resolved
     * form regardless of the literal path a worktree was created through —
     * confirmed empirically: creating a worktree via a symlinked path still
     * gets reported under the symlink's target. Falls back to the original
     * path if it doesn't exist (or `realPath` fails for any other reason)
     * rather than failing — this is a best-effort comparison aid, not a
     * correctness-critical resolution. */
    const realpathOrSelf = (p: string): Effect.Effect<string> =>
      fs.realPath(p).pipe(Effect.catch(() => Effect.succeed(p)))
    return GitFs.of({
      diffStat: (base, ref, absPath) => {
        const rel = toPosix(nodePath.relative(base, absPath))
        return Effect.provideService(
          runGit(base, ['diff', '--numstat', ref, '--', rel]),
          ChildProcessSpawner.ChildProcessSpawner,
          spawner,
        ).pipe(
          Effect.map((stdout) => {
            // `--numstat` emits one line "<added>\t<removed>\t<path>"; empty
            // stdout means the content is identical at both ends (a real,
            // valid "no change" answer, not an absence). A binary file
            // reports literal `-` for both counts, which `parseDigits`
            // rejects (not a raw `Number()` coercion into `NaN`) — the
            // deliberate signal to return `null` rather than a fabricated
            // `0/0` that would misrepresent "can't tell" as "no change".
            const line = stdout.split('\n').find((l) => l.trim().length > 0)
            if (line === undefined) {
              return { added: 0, removed: 0 }
            }
            const [addedRaw, removedRaw] = line.split('\t')
            const added = parseDigits(addedRaw)
            const removed = parseDigits(removedRaw)
            return added === null || removed === null ? null : { added, removed }
          }),
        )
      },
      historyForPath: (base, absPath) => {
        const rel = toPosix(nodePath.relative(base, absPath))
        return Effect.provideService(
          runGit(base, ['log', '--format=%H', '--', rel]),
          ChildProcessSpawner.ChildProcessSpawner,
          spawner,
        ).pipe(Effect.map((stdout) => stdout.split('\n').filter((line) => line.trim().length > 0)))
      },
      lastCommitDate: (base, absPath) => {
        const rel = toPosix(nodePath.relative(base, absPath))
        return Effect.provideService(
          runGit(base, ['log', '-1', '--format=%cI', '--', rel]),
          ChildProcessSpawner.ChildProcessSpawner,
          spawner,
        ).pipe(
          Effect.map((stdout) => {
            const trimmed = stdout.trim()
            return trimmed.length === 0 ? null : new Date(trimmed)
          }),
        )
      },
      listDeletedSince: (base, ref) =>
        Effect.provideService(
          // `--` disambiguates `ref` from a pathspec — without it, a `ref`
          // that ISN'T a valid revision but happens to match a real path in
          // the repo is silently reinterpreted by git as a path filter
          // (scoped worktree-vs-index diff) instead of erroring, exactly
          // the kind of silent wrong-thing this repo's own `onlyGitTracked`
          // philosophy (never a quiet fallback) exists to prevent.
          // Confirmed by reproducing it directly in a scratch repo.
          runGit(base, ['diff', '--name-status', '--diff-filter=D', '-z', ref, '--']),
          ChildProcessSpawner.ChildProcessSpawner,
          spawner,
        ).pipe(
          Effect.map((stdout) => {
            // `-z`-terminated pairs: "D\0<path>\0D\0<path2>\0..." — every
            // entry here is already filtered to `D` (deleted) by
            // `--diff-filter=D`, so every second element (odd index) is a
            // deleted path; the interleaved status letters (index 0, 2, 4…)
            // are dropped. `--name-status -z`'s pairing is a fixed git
            // format guarantee, not something to defensively re-validate.
            const entries = stdout.split('\0').filter((entry) => entry.length > 0)
            const paths: string[] = []
            for (let i = 1; i < entries.length; i += 2) {
              paths.push(toAbsPosix(base, entries[i] as string))
            }
            return paths
          }),
        ),
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
          Effect.flatMap((stdout) =>
            Effect.gen(function* () {
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
              //
              // A second, distinct shape of the same bug (real bug report,
              // reproduced with just 2 worktrees): a linked worktree can ALSO
              // be nested INSIDE another worktree's own directory — e.g.
              // `<primary>/.claude/worktrees/<name>`, exactly what an
              // agentic dev workflow creates — rather than living as a
              // sibling under some shared parent. If `base` is such a nested
              // worktree, the primary worktree (or any other worktree that
              // is an ANCESTOR of `base`, not just equal to it) must ALSO be
              // excluded here: `cli.ts` turns every reported dir into
              // `${dir}/**`, and an ancestor's `${ancestor}/**` pattern
              // matches every file under `base` too, since `base`'s own real
              // path literally starts with the ancestor's — pruning the scan
              // root by a different route than the exact-equality case
              // above, but with the identical "0 files, all clean" result.
              const baseReal = toPosix(yield* realpathOrSelf(base))
              const paths = stdout
                .split('\n')
                .filter((line) => line.startsWith('worktree '))
                .map((line) => line.slice('worktree '.length).trim())
                .map((p) => toAbsPosix(base, p))
              const withReal = yield* Effect.all(
                paths.map((p) => realpathOrSelf(p).pipe(Effect.map((real) => [p, toPosix(real)] as const))),
              )
              return withReal
                .filter(([, pReal]) => pReal !== baseReal && !baseReal.startsWith(`${pReal}/`))
                .map(([p]) => p)
            }),
          ),
        ),
      readFileAtRef: (base, ref, absPath) => {
        const rel = toPosix(nodePath.relative(base, absPath))
        return Effect.provideService(
          runGit(base, ['show', `${ref}:${rel}`]),
          ChildProcessSpawner.ChildProcessSpawner,
          spawner,
        )
      },
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
  atRef: ReadonlyMap<string, string> = new Map(),
  deletedSince: readonly string[] | GitUnavailableError = [],
  // `lastCommitDate`'s own double: unlike `atRef` (missing entry = hard
  // fail, since a real caller only ever asks for a path it already knows
  // existed at that ref), a path absent from `lastCommitDates` legitimately
  // means "no commit history yet" — the real implementation's own `null`
  // case, not a test-double gap — so it defaults to `null`, not a failure.
  lastCommitDates: ReadonlyMap<string, Date> | GitUnavailableError = new Map(),
  // `historyForPath`'s own double: a path absent from `history` legitimately
  // means "no commit history yet" (real impl's `[]`), same non-failure
  // default as `lastCommitDates` above.
  history: ReadonlyMap<string, readonly string[]> | GitUnavailableError = new Map(),
  // `diffStat`'s own double — keyed by `absPath` alone (like `atRef` above),
  // since no test built on this double needs to distinguish by `ref`. A path
  // absent defaults to `null` (real impl's "can't tell" answer), not a
  // failure — a caller-supplied bad `ref` failing outright is a real,
  // separate case this double doesn't need to simulate.
  diffStats: ReadonlyMap<string, { added: number; removed: number } | null> | GitUnavailableError = new Map(),
): Layer.Layer<GitFs> =>
  Layer.succeed(GitFs, {
    diffStat: (_base, _ref, absPath) =>
      diffStats instanceof GitUnavailableError
        ? Effect.fail(diffStats)
        : Effect.succeed(diffStats.get(absPath) ?? null),
    historyForPath: (_base, absPath) =>
      history instanceof GitUnavailableError ? Effect.fail(history) : Effect.succeed(history.get(absPath) ?? []),
    lastCommitDate: (_base, absPath) =>
      lastCommitDates instanceof GitUnavailableError
        ? Effect.fail(lastCommitDates)
        : Effect.succeed(lastCommitDates.get(absPath) ?? null),
    listDeletedSince: () =>
      deletedSince instanceof GitUnavailableError ? Effect.fail(deletedSince) : Effect.succeed(deletedSince),
    listIgnoredDirs: () =>
      ignoredDirs instanceof GitUnavailableError ? Effect.fail(ignoredDirs) : Effect.succeed(ignoredDirs),
    listTrackedFiles: () => (tracked instanceof GitUnavailableError ? Effect.fail(tracked) : Effect.succeed(tracked)),
    listWorktreeDirs: () =>
      worktreeDirs instanceof GitUnavailableError ? Effect.fail(worktreeDirs) : Effect.succeed(worktreeDirs),
    // No entry in `atRef` fails, matching the real implementation's
    // contract (propagates, never a silent `null`) — a test double that
    // silently succeeded with some default would misrepresent that
    // contract to every test built on it.
    readFileAtRef: (base, _ref, absPath) => {
      const content = atRef.get(absPath)
      return content === undefined
        ? Effect.fail(new GitUnavailableError({ base, message: `no content recorded in test double for ${absPath}` }))
        : Effect.succeed(content)
    },
  })
