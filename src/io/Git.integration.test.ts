import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toPosix } from '../core/paths.ts'
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

const git = (cwd: string, ...args: readonly string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

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
