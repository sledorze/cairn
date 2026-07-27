import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import type * as Scope from 'effect/Scope'
import { afterAll, beforeAll } from 'vitest'

import { toPosix } from '../core/paths.ts'
import { runGit as git } from '../testSupport/testGit.ts'
import { GitFs, GitFsLive, GitUnavailableError } from './Git.ts'

// Exercises the REAL `git` binary (GitFsLive) against a real repository —
// issue #48's own acceptance criterion 1 ("tracked + staged, the index, not
// just the last commit, not just the worktree") is a claim about actual git
// semantics, not something an in-memory double could prove.
//
// Uses `@effect/vitest`'s `it.layer(...)` to provide `GitFsLive` (composed with the
// Node `ChildProcessSpawner` implementation) once per section, and `it.effect` to run
// each test's Effect directly — no manual `Effect.runPromise(...)` boilerplate, and
// `it.effect` already provides/tears down a `Scope` per test (this version of
// `@effect/vitest` has no separate `it.scoped` — `Tester<R | Scope.Scope>` folds that
// in), so `Effect.acquireRelease` resources below need no extra wrapping.

const GitFsTestLive = GitFsLive.pipe(Layer.provide(NodeServices.layer))

// Effect-native temp-dir/env-var/fake-binary lifecycle for the regression tests below —
// acquired and released as `Effect` resources (`Effect.acquireRelease`), torn down
// automatically by `it.effect`'s own per-test `Scope`.
const acquireTempDir = (prefix: string): Effect.Effect<string, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), prefix))),
    (dir) => Effect.sync(() => fs.rmSync(dir, { force: true, recursive: true })),
  )

const acquireEnvVar = (name: string, value: string): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      process.env[name] = value
    }),
    () =>
      Effect.sync(() => {
        delete process.env[name]
      }),
  )

/** Prepends a fake `git` binary (a `#!/bin/sh` script) to `PATH` for the scope's
 * duration — real subprocess behaviour (a real, if fake, executable), matching this
 * file's own "test real git behaviour" discipline, rather than mocking `child_process`. */
const acquireFakeGitBinary = (scriptBody: string): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-fake-git-'))
      fs.writeFileSync(path.join(fakeBinDir, 'git'), scriptBody, { mode: 0o755 })
      const originalPath = process.env.PATH
      process.env.PATH = `${fakeBinDir}:${originalPath}`
      return { fakeBinDir, originalPath }
    }),
    ({ fakeBinDir, originalPath }) =>
      Effect.sync(() => {
        process.env.PATH = originalPath
        fs.rmSync(fakeBinDir, { force: true, recursive: true })
      }),
  )

/** Points `PATH` at a directory with no `git` binary at all, for the scope's duration. */
const acquireNoGitOnPath = (): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const originalPath = process.env.PATH
      process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-no-git-'))
      return originalPath
    }),
    (originalPath) => Effect.sync(() => (process.env.PATH = originalPath)),
  )

it.layer(GitFsTestLive)('GitFsLive()', (layerIt) => {
  let root = ''

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-'))
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'config', 'user.name', 'Test')

    fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs', 'committed.md'), '# committed')
    git(root, 'add', 'docs/committed.md')
    git(root, 'commit', '-q', '-m', 'initial')

    // Staged but not yet committed — issue #48 criterion 1 says this MUST count
    // as tracked (the index, not just HEAD).
    fs.writeFileSync(path.join(root, 'docs', 'staged.md'), '# staged')
    git(root, 'add', 'docs/staged.md')

    // Genuinely untracked — never `git add`-ed. This is the issue's own motivating example.
    fs.writeFileSync(path.join(root, 'docs', 'scratch-notes.md'), '# scratch')
  })

  afterAll(() => {
    if (root) {
      fs.rmSync(root, { force: true, recursive: true })
    }
  })

  layerIt.effect('includes committed files', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const tracked = yield* gitFs.listTrackedFiles(root)
      const committedAbs = toPosix(path.join(root, 'docs', 'committed.md'))
      expect(tracked.has(committedAbs)).toBeTruthy()
    }),
  )

  layerIt.effect('includes staged-but-uncommitted files (the index, not just HEAD)', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const tracked = yield* gitFs.listTrackedFiles(root)
      const stagedAbs = toPosix(path.join(root, 'docs', 'staged.md'))
      expect(tracked.has(stagedAbs)).toBeTruthy()
    }),
  )

  layerIt.effect('excludes genuinely untracked files — the issue #48 motivating example', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const tracked = yield* gitFs.listTrackedFiles(root)
      const scratchAbs = toPosix(path.join(root, 'docs', 'scratch-notes.md'))
      expect(tracked.has(scratchAbs)).toBeFalsy()
    }),
  )

  layerIt.effect(
    'fails with a named GitUnavailableError (never a silent empty set) when `base` is not a git repository',
    () =>
      Effect.gen(function* () {
        const nonRepo = yield* acquireTempDir('not-a-repo-')
        const gitFs = yield* GitFs
        const error = yield* Effect.flip(gitFs.listTrackedFiles(nonRepo))
        expect(error).toBeInstanceOf(GitUnavailableError)
        expect(error.base).toBe(nonRepo)
      }),
  )

  // GitFsLive wraps two distinct failure shapes into GitUnavailableError: a git
  // command that runs but exits non-zero (exercised just above via a real non-repo
  // `base`), and a genuine PlatformError — the process couldn't even be spawned, or
  // a stream/exit-code read itself failed. Both real, both against a real (if
  // sometimes fake) `git` binary.
  layerIt.effect('falls back to an exit-code message when a failing command produces no stderr at all', () =>
    Effect.gen(function* () {
      yield* acquireFakeGitBinary('#!/bin/sh\nexit 7\n')
      const gitFs = yield* GitFs
      const error = yield* Effect.flip(gitFs.listTrackedFiles(root))
      expect(error).toBeInstanceOf(GitUnavailableError)
      expect(error.message).toContain('7')
    }),
  )

  layerIt.effect('wraps a genuine PlatformError (git binary entirely unavailable) into GitUnavailableError', () =>
    Effect.gen(function* () {
      yield* acquireNoGitOnPath()
      const gitFs = yield* GitFs
      const error = yield* Effect.flip(gitFs.listTrackedFiles(root))
      expect(error).toBeInstanceOf(GitUnavailableError)
      expect(error.base).toBe(root)
    }),
  )
})

// Issue #63: `listIgnoredDirs` is what lets `cairn` prune a real gitignored
// `node_modules` before ever walking into it, without requiring the user to
// hand-configure `ignore: ["**/node_modules/**"]` — real, against the real
// `git` binary, matching this file's own established discipline.
it.layer(GitFsTestLive)('GitFsLive().listIgnoredDirs()', (layerIt) => {
  let ignoreRoot = ''

  beforeAll(() => {
    ignoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-ignored-'))
    git(ignoreRoot, 'init', '-q')
    git(ignoreRoot, 'config', 'user.email', 'test@example.com')
    git(ignoreRoot, 'config', 'user.name', 'Test')
    fs.writeFileSync(path.join(ignoreRoot, '.gitignore'), 'node_modules/\ndist/\n')
    fs.mkdirSync(path.join(ignoreRoot, 'node_modules', 'some-pkg'), { recursive: true })
    fs.writeFileSync(path.join(ignoreRoot, 'node_modules', 'some-pkg', 'index.js'), '// noop')
    fs.mkdirSync(path.join(ignoreRoot, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(ignoreRoot, 'dist', 'out.js'), '// noop')
    fs.mkdirSync(path.join(ignoreRoot, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(ignoreRoot, 'docs', 'guide.md'), '# guide')
    git(ignoreRoot, 'add', '.gitignore', 'docs')
    git(ignoreRoot, 'commit', '-q', '-m', 'initial')
  })

  afterAll(() => {
    if (ignoreRoot) {
      fs.rmSync(ignoreRoot, { force: true, recursive: true })
    }
  })

  layerIt.effect(
    'reports every real gitignored directory as one collapsed entry, absolute POSIX, no trailing slash',
    () =>
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        const dirs = yield* gitFs.listIgnoredDirs(ignoreRoot)
        expect(dirs).toContain(toPosix(path.join(ignoreRoot, 'node_modules')))
        expect(dirs).toContain(toPosix(path.join(ignoreRoot, 'dist')))
        expect(dirs.some((d) => d.endsWith('/'))).toBeFalsy()
      }),
  )

  layerIt.effect('does not report a real, tracked, non-ignored directory', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const dirs = yield* gitFs.listIgnoredDirs(ignoreRoot)
      expect(dirs).not.toContain(toPosix(path.join(ignoreRoot, 'docs')))
    }),
  )

  layerIt.effect(
    'never descends into the ignored directory itself — a file inside it is reported only as part of the collapsed directory entry, not individually',
    () =>
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        const dirs = yield* gitFs.listIgnoredDirs(ignoreRoot)
        expect(dirs.some((d) => d.includes('some-pkg') || d.includes('index.js'))).toBeFalsy()
      }),
  )

  layerIt.effect('fails with a named GitUnavailableError when `base` is not a git repository', () =>
    Effect.gen(function* () {
      const nonRepo = yield* acquireTempDir('not-a-repo-ignored-')
      const gitFs = yield* GitFs
      const error = yield* Effect.flip(gitFs.listIgnoredDirs(nonRepo))
      expect(error).toBeInstanceOf(GitUnavailableError)
    }),
  )
})

// Regression coverage for the incident this repo hit for real: when the checkout is a
// linked `git worktree`, git exports GIT_DIR (and, during pre-commit, GIT_INDEX_FILE)
// into hook subprocesses. `cairn`'s own lefthook.yml runs `pnpm check` — i.e. GitFsLive
// — from inside such a hook, so an unscrubbed `-C base` is a real, user-facing bug: it
// silently overrides `-C`, not just a test-hygiene concern. See src/io/gitEnv.ts.
it.layer(GitFsTestLive)('GitFsLive() is isolated from a leaked GIT_DIR / GIT_INDEX_FILE (regression)', (layerIt) => {
  let decoyRoot = ''
  let decoyMarker = ''

  beforeAll(() => {
    // A second, independent real repo whose file list is provably different from
    // `root`'s (declared in the first block above) — if a leaked GIT_DIR ever wins
    // over `-C`, these tests will observe THIS repo's marker file instead of the
    // real target's.
    decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-decoy-'))
    git(decoyRoot, 'init', '-q')
    git(decoyRoot, 'config', 'user.email', 'decoy@example.com')
    git(decoyRoot, 'config', 'user.name', 'Decoy')
    fs.writeFileSync(path.join(decoyRoot, 'decoy-only-file.md'), '# decoy')
    git(decoyRoot, 'add', 'decoy-only-file.md')
    git(decoyRoot, 'commit', '-q', '-m', 'decoy initial')
    decoyMarker = toPosix(path.join(decoyRoot, 'decoy-only-file.md'))
  })

  afterAll(() => {
    if (decoyRoot) {
      fs.rmSync(decoyRoot, { force: true, recursive: true })
    }
  })

  layerIt.effect(
    "listTrackedFiles(base) reports `base`'s own files, never the decoy's, when GIT_DIR points at the decoy",
    () =>
      Effect.gen(function* () {
        const target = yield* acquireTempDir('gitfs-leak-target-')
        git(target, 'init', '-q')
        git(target, 'config', 'user.email', 'test@example.com')
        git(target, 'config', 'user.name', 'Test')
        fs.writeFileSync(path.join(target, 'committed.md'), '# committed')
        git(target, 'add', 'committed.md')
        git(target, 'commit', '-q', '-m', 'initial')

        yield* acquireEnvVar('GIT_DIR', path.join(decoyRoot, '.git'))
        const gitFs = yield* GitFs
        const tracked = yield* gitFs.listTrackedFiles(target)
        const committedAbs = toPosix(path.join(target, 'committed.md'))
        expect(tracked.has(decoyMarker)).toBeFalsy()
        expect(tracked.has(committedAbs)).toBeTruthy()
      }),
  )

  layerIt.effect(
    'still fails with GitUnavailableError for a real non-repo `base`, even with GIT_DIR pointing at a real decoy repo',
    () =>
      Effect.gen(function* () {
        const nonRepo = yield* acquireTempDir('not-a-repo-leaked-')
        yield* acquireEnvVar('GIT_DIR', path.join(decoyRoot, '.git'))
        const gitFs = yield* GitFs
        const error = yield* Effect.flip(gitFs.listTrackedFiles(nonRepo))
        expect(error).toBeInstanceOf(GitUnavailableError)
      }),
  )

  layerIt.effect(
    'runGit() fixture helper commits land in the target temp repo, never the decoy, even with GIT_DIR and an absolute GIT_INDEX_FILE leaked',
    () =>
      Effect.gen(function* () {
        const target = yield* acquireTempDir('gitfs-fixture-target-')
        yield* Effect.sync(() => {
          git(target, 'init', '-q')
          git(target, 'config', 'user.email', 'test@example.com')
          git(target, 'config', 'user.name', 'Test')
        })

        // Leaked env vars stay set through the assertions below too — proving
        // GitFsLive's own scrubbing, not test-side cleanup ordering, is what
        // makes these calls correct.
        yield* acquireEnvVar('GIT_DIR', path.join(decoyRoot, '.git'))
        yield* acquireEnvVar('GIT_INDEX_FILE', path.join(decoyRoot, '.git', 'index'))

        yield* Effect.sync(() => {
          fs.writeFileSync(path.join(target, 'fixture-file.md'), '# fixture')
          git(target, 'add', 'fixture-file.md')
          git(target, 'commit', '-q', '-m', 'fixture commit')
        })

        const fixtureFileAbs = toPosix(path.join(target, 'fixture-file.md'))
        const gitFs = yield* GitFs
        const targetTracked = yield* gitFs.listTrackedFiles(target)
        const decoyTracked = yield* gitFs.listTrackedFiles(decoyRoot)

        expect(targetTracked.has(fixtureFileAbs)).toBeTruthy()
        expect(decoyTracked.has(fixtureFileAbs)).toBeFalsy()
        expect([...decoyTracked]).toEqual([decoyMarker])
      }),
  )
})

// A linked worktree (e.g. `.claude/worktrees/<name>`) checks out a full copy
// of the repo's own doc tree at a different commit/branch, nested inside the
// primary worktree. Walking it doubles every summary/link finding (and, if
// it itself has a real `node_modules`, reintroduces the exact issue #63 OOM
// shape) — so it needs pruning the same way an ignored directory does, real,
// against the real `git` binary.
it.layer(GitFsTestLive)('GitFsLive().listWorktreeDirs()', (layerIt) => {
  let wtRoot = ''
  let linkedPath = ''

  beforeAll(() => {
    wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-worktree-'))
    git(wtRoot, 'init', '-q')
    git(wtRoot, 'config', 'user.email', 'test@example.com')
    git(wtRoot, 'config', 'user.name', 'Test')
    fs.mkdirSync(path.join(wtRoot, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(wtRoot, 'docs', 'guide.md'), '# guide')
    git(wtRoot, 'add', 'docs')
    git(wtRoot, 'commit', '-q', '-m', 'initial')

    linkedPath = path.join(wtRoot, '.claude', 'worktrees', 'some-branch')
    fs.mkdirSync(path.dirname(linkedPath), { recursive: true })
    git(wtRoot, 'worktree', 'add', '-q', '-b', 'some-branch', linkedPath)
  })

  afterAll(() => {
    if (wtRoot) {
      // `git worktree remove` first so git's own metadata doesn't leak past
      // the temp-dir cleanup; tolerate failure since `rmSync` below is the
      // real backstop.
      try {
        git(wtRoot, 'worktree', 'remove', '--force', linkedPath)
      } catch {
        // best-effort
      }
      fs.rmSync(wtRoot, { force: true, recursive: true })
    }
  })

  layerIt.effect('reports the linked worktree directory, absolute POSIX, no trailing slash', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const dirs = yield* gitFs.listWorktreeDirs(wtRoot)
      expect(dirs).toContain(toPosix(linkedPath))
      expect(dirs.some((d) => d.endsWith('/'))).toBeFalsy()
    }),
  )

  layerIt.effect('does not report the primary worktree itself', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const dirs = yield* gitFs.listWorktreeDirs(wtRoot)
      expect(dirs).not.toContain(toPosix(wtRoot))
    }),
  )

  // Regression (found by dogfooding this repo's own multi-worktree dev setup, not by
  // this test suite): `git worktree list --porcelain` always lists the PRIMARY
  // worktree first, which is a different thing from `base`. Calling this from a
  // LINKED worktree's own perspective (`base` = the linked one, not the primary) is
  // exactly the case that broke — `base` itself leaked into the result, and callers
  // (`cli.ts`) add every reported dir to `ignore` as `${dir}/**`, so `base` itself
  // silently became fully excluded from its own scan (a false "0 files, all clean").
  layerIt.effect('reports the PRIMARY worktree, and never `base` itself, when `base` is the linked worktree', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const dirs = yield* gitFs.listWorktreeDirs(linkedPath)
      expect(dirs).toContain(toPosix(wtRoot))
      expect(dirs).not.toContain(toPosix(linkedPath))
    }),
  )

  // Regression, found by dogfooding the fix above against this repo's own dev setup:
  // `git worktree list --porcelain` reports its own realpath-resolved form regardless
  // of the literal path a worktree was created/queried through (confirmed empirically:
  // a worktree created via a symlinked path is still reported under the symlink's
  // *target*). A `base` reached through a symlink — e.g. macOS's `/tmp` resolving to
  // `/private/tmp` — would therefore leak back into the result under its resolved
  // name, reproducing the exact bug above in symlink form. `os.tmpdir()` isn't
  // guaranteed to be a symlink on every platform this suite runs on, so this test
  // creates one explicitly rather than relying on the host's `/tmp` layout.
  layerIt.effect('reports the primary worktree correctly even when `base` is reached through a symlink', () =>
    Effect.gen(function* () {
      const parentDir = yield* acquireTempDir('gitfs-worktree-symlink-parent-')
      const viaSymlink = path.join(parentDir, 'via-symlink')
      yield* Effect.sync(() => fs.symlinkSync(linkedPath, viaSymlink, 'dir'))
      const gitFs = yield* GitFs
      const dirs = yield* gitFs.listWorktreeDirs(viaSymlink)
      expect(dirs).toContain(toPosix(wtRoot))
      expect(dirs).not.toContain(toPosix(linkedPath))
      expect(dirs).not.toContain(toPosix(viaSymlink))
    }),
  )

  // A worktree directory deleted without `git worktree remove` first (a real,
  // ordinary mistake — `rm -rf` instead of the git command) leaves a stale,
  // `prunable` entry in `git worktree list --porcelain` whose path no longer
  // exists on disk; `realpathOrSelf` must fall back to the raw path rather than
  // throwing, so this call still succeeds instead of crashing the whole scan.
  layerIt.effect('does not crash when a reported worktree directory no longer exists on disk', () =>
    Effect.gen(function* () {
      const deletedWtPath = path.join(wtRoot, '.claude', 'worktrees', 'deleted-branch')
      git(wtRoot, 'worktree', 'add', '-q', '-b', 'deleted-branch', deletedWtPath)
      fs.rmSync(deletedWtPath, { force: true, recursive: true })

      const gitFs = yield* GitFs
      const dirs = yield* gitFs.listWorktreeDirs(wtRoot)
      expect(dirs).toContain(toPosix(linkedPath))
      expect(dirs).toContain(toPosix(deletedWtPath))
    }),
  )

  layerIt.effect('fails with a named GitUnavailableError when `base` is not a git repository', () =>
    Effect.gen(function* () {
      const nonRepo = yield* acquireTempDir('not-a-repo-worktree-')
      const gitFs = yield* GitFs
      const error = yield* Effect.flip(gitFs.listWorktreeDirs(nonRepo))
      expect(error).toBeInstanceOf(GitUnavailableError)
    }),
  )
})
