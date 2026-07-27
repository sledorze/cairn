import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { toPosix } from '../core/paths.ts'
import { runGit as git } from '../testSupport/testGit.ts'
import { GitFs, GitFsLive, GitUnavailableError } from './Git.ts'

// Exercises the REAL `git` binary (GitFsLive) against a real repository —
// issue #48's own acceptance criterion 1 ("tracked + staged, the index, not
// just the last commit, not just the worktree") is a claim about actual git
// semantics, not something an in-memory double could prove.

let root = ''

const run = (base: string): Promise<ReadonlySet<string>> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      return yield* gitFs.listTrackedFiles(base)
    }).pipe(Effect.provide(GitFsLive)),
  )

const runIgnoredDirs = (base: string): Promise<readonly string[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      return yield* gitFs.listIgnoredDirs(base)
    }).pipe(Effect.provide(GitFsLive)),
  )

const runWorktreeDirs = (base: string): Promise<readonly string[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      return yield* gitFs.listWorktreeDirs(base)
    }).pipe(Effect.provide(GitFsLive)),
  )

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

describe('GitFsLive()', () => {
  it('includes committed files', async () => {
    const tracked = await run(root)
    const committedAbs = toPosix(path.join(root, 'docs', 'committed.md'))
    expect(tracked.has(committedAbs)).toBeTruthy()
  })

  it('includes staged-but-uncommitted files (the index, not just HEAD)', async () => {
    const tracked = await run(root)
    const stagedAbs = toPosix(path.join(root, 'docs', 'staged.md'))
    expect(tracked.has(stagedAbs)).toBeTruthy()
  })

  it('excludes genuinely untracked files — the issue #48 motivating example', async () => {
    const tracked = await run(root)
    const scratchAbs = toPosix(path.join(root, 'docs', 'scratch-notes.md'))
    expect(tracked.has(scratchAbs)).toBeFalsy()
  })

  it('fails with a named GitUnavailableError (never a silent empty set) when `base` is not a git repository', async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.gen(function* () {
            const gitFs = yield* GitFs
            return yield* gitFs.listTrackedFiles(nonRepo)
          }),
        ).pipe(Effect.provide(GitFsLive)),
      )
      expect(error).toBeInstanceOf(GitUnavailableError)
      expect(error.base).toBe(nonRepo)
    } finally {
      fs.rmSync(nonRepo, { force: true, recursive: true })
    }
  })
})

// Issue #63: `listIgnoredDirs` is what lets `cairn` prune a real gitignored
// `node_modules` before ever walking into it, without requiring the user to
// hand-configure `ignore: ["**/node_modules/**"]` — real, against the real
// `git` binary, matching this file's own established discipline.
describe('GitFsLive().listIgnoredDirs()', () => {
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

  it('reports every real gitignored directory as one collapsed entry, absolute POSIX, no trailing slash', async () => {
    const dirs = await runIgnoredDirs(ignoreRoot)
    expect(dirs).toContain(toPosix(path.join(ignoreRoot, 'node_modules')))
    expect(dirs).toContain(toPosix(path.join(ignoreRoot, 'dist')))
    expect(dirs.some((d) => d.endsWith('/'))).toBeFalsy()
  })

  it('does not report a real, tracked, non-ignored directory', async () => {
    const dirs = await runIgnoredDirs(ignoreRoot)
    expect(dirs).not.toContain(toPosix(path.join(ignoreRoot, 'docs')))
  })

  it('never descends into the ignored directory itself — a file inside it is reported only as part of the collapsed directory entry, not individually', async () => {
    const dirs = await runIgnoredDirs(ignoreRoot)
    expect(dirs.some((d) => d.includes('some-pkg') || d.includes('index.js'))).toBeFalsy()
  })

  it('fails with a named GitUnavailableError when `base` is not a git repository', async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-ignored-'))
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.gen(function* () {
            const gitFs = yield* GitFs
            return yield* gitFs.listIgnoredDirs(nonRepo)
          }),
        ).pipe(Effect.provide(GitFsLive)),
      )
      expect(error).toBeInstanceOf(GitUnavailableError)
    } finally {
      fs.rmSync(nonRepo, { force: true, recursive: true })
    }
  })
})

// Regression coverage for the incident this repo hit for real: when the checkout is a
// linked `git worktree`, git exports GIT_DIR (and, during pre-commit, GIT_INDEX_FILE)
// into hook subprocesses. `cairn`'s own lefthook.yml runs `pnpm check` — i.e. GitFsLive
// — from inside such a hook, so an unscrubbed `-C base` is a real, user-facing bug: it
// silently overrides `-C`, not just a test-hygiene concern. See src/io/gitEnv.ts.
describe('GitFsLive() is isolated from a leaked GIT_DIR / GIT_INDEX_FILE (regression)', () => {
  let decoyRoot = ''
  let decoyMarker = ''

  beforeAll(() => {
    // A second, independent real repo whose file list is provably different from
    // `root`'s (declared above) — if a leaked GIT_DIR ever wins over `-C`, these
    // tests will observe THIS repo's marker file instead of the real target's.
    decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-decoy-'))
    git(decoyRoot, 'init', '-q')
    git(decoyRoot, 'config', 'user.email', 'decoy@example.com')
    git(decoyRoot, 'config', 'user.name', 'Decoy')
    fs.writeFileSync(path.join(decoyRoot, 'decoy-only-file.md'), '# decoy')
    git(decoyRoot, 'add', 'decoy-only-file.md')
    git(decoyRoot, 'commit', '-q', '-m', 'decoy initial')
    decoyMarker = toPosix(path.join(decoyRoot, 'decoy-only-file.md'))
  })

  afterEach(() => {
    delete process.env.GIT_DIR
    delete process.env.GIT_INDEX_FILE
  })

  afterAll(() => {
    if (decoyRoot) {
      fs.rmSync(decoyRoot, { force: true, recursive: true })
    }
  })

  it("listTrackedFiles(base) reports `base`'s own files, never the decoy's, when GIT_DIR points at the decoy", async () => {
    process.env.GIT_DIR = path.join(decoyRoot, '.git')
    const tracked = await run(root)
    const committedAbs = toPosix(path.join(root, 'docs', 'committed.md'))
    expect(tracked.has(decoyMarker)).toBeFalsy()
    expect(tracked.has(committedAbs)).toBeTruthy()
  })

  it('still fails with GitUnavailableError for a real non-repo `base`, even with GIT_DIR pointing at a real decoy repo', async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-leaked-'))
    process.env.GIT_DIR = path.join(decoyRoot, '.git')
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.gen(function* () {
            const gitFs = yield* GitFs
            return yield* gitFs.listTrackedFiles(nonRepo)
          }),
        ).pipe(Effect.provide(GitFsLive)),
      )
      expect(error).toBeInstanceOf(GitUnavailableError)
    } finally {
      fs.rmSync(nonRepo, { force: true, recursive: true })
    }
  })

  it('runGit() fixture helper commits land in the target temp repo, never the decoy, even with GIT_DIR and an absolute GIT_INDEX_FILE leaked', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfs-fixture-target-'))
    try {
      git(target, 'init', '-q')
      git(target, 'config', 'user.email', 'test@example.com')
      git(target, 'config', 'user.name', 'Test')

      process.env.GIT_DIR = path.join(decoyRoot, '.git')
      process.env.GIT_INDEX_FILE = path.join(decoyRoot, '.git', 'index')

      fs.writeFileSync(path.join(target, 'fixture-file.md'), '# fixture')
      git(target, 'add', 'fixture-file.md')
      git(target, 'commit', '-q', '-m', 'fixture commit')

      delete process.env.GIT_DIR
      delete process.env.GIT_INDEX_FILE

      const fixtureFileAbs = toPosix(path.join(target, 'fixture-file.md'))

      const targetTracked = await run(target)
      expect(targetTracked.has(fixtureFileAbs)).toBeTruthy()

      const decoyTracked = await run(decoyRoot)
      expect(decoyTracked.has(fixtureFileAbs)).toBeFalsy()
      const decoyFiles = [...decoyTracked]
      expect(decoyFiles).toEqual([decoyMarker])
    } finally {
      fs.rmSync(target, { force: true, recursive: true })
    }
  })
})

// A linked worktree (e.g. `.claude/worktrees/<name>`) checks out a full copy
// of the repo's own doc tree at a different commit/branch, nested inside the
// primary worktree. Walking it doubles every summary/link finding (and, if
// it itself has a real `node_modules`, reintroduces the exact issue #63 OOM
// shape) — so it needs pruning the same way an ignored directory does, real,
// against the real `git` binary.
describe('GitFsLive().listWorktreeDirs()', () => {
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

  it('reports the linked worktree directory, absolute POSIX, no trailing slash', async () => {
    const dirs = await runWorktreeDirs(wtRoot)
    expect(dirs).toContain(toPosix(linkedPath))
    expect(dirs.some((d) => d.endsWith('/'))).toBeFalsy()
  })

  it('does not report the primary worktree itself', async () => {
    const dirs = await runWorktreeDirs(wtRoot)
    expect(dirs).not.toContain(toPosix(wtRoot))
  })

  it('fails with a named GitUnavailableError when `base` is not a git repository', async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-worktree-'))
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.gen(function* () {
            const gitFs = yield* GitFs
            return yield* gitFs.listWorktreeDirs(nonRepo)
          }),
        ).pipe(Effect.provide(GitFsLive)),
      )
      expect(error).toBeInstanceOf(GitUnavailableError)
    } finally {
      fs.rmSync(nonRepo, { force: true, recursive: true })
    }
  })
})
