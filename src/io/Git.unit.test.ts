import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { GitFs, GitUnavailableError, makeTestGitFs } from './Git.ts'

// makeTestGitFs itself had never been exercised by any test (a real,
// pre-existing gap the coverage ratchet surfaced once issue #63's
// listIgnoredDirs addition grew the file) — this closes it directly, in
// memory, rather than only via the real-git integration test.

const runTracked = (layer: ReturnType<typeof makeTestGitFs>): Promise<ReadonlySet<string>> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      return yield* gitFs.listTrackedFiles('/base')
    }).pipe(Effect.provide(layer)),
  )

const runIgnoredDirs = (layer: ReturnType<typeof makeTestGitFs>): Promise<readonly string[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      return yield* gitFs.listIgnoredDirs('/base')
    }).pipe(Effect.provide(layer)),
  )

const runTrackedFailure = (layer: ReturnType<typeof makeTestGitFs>): Promise<GitUnavailableError> =>
  Effect.runPromise(
    Effect.flip(
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        return yield* gitFs.listTrackedFiles('/base')
      }),
    ).pipe(Effect.provide(layer)),
  )

const runIgnoredDirsFailure = (layer: ReturnType<typeof makeTestGitFs>): Promise<GitUnavailableError> =>
  Effect.runPromise(
    Effect.flip(
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        return yield* gitFs.listIgnoredDirs('/base')
      }),
    ).pipe(Effect.provide(layer)),
  )

const runWorktreeDirs = (layer: ReturnType<typeof makeTestGitFs>): Promise<readonly string[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      return yield* gitFs.listWorktreeDirs('/base')
    }).pipe(Effect.provide(layer)),
  )

const runWorktreeDirsFailure = (layer: ReturnType<typeof makeTestGitFs>): Promise<GitUnavailableError> =>
  Effect.runPromise(
    Effect.flip(
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        return yield* gitFs.listWorktreeDirs('/base')
      }),
    ).pipe(Effect.provide(layer)),
  )

describe('makeTestGitFs()', () => {
  it('listTrackedFiles() reports the supplied set', async () => {
    const tracked = new Set(['/base/a.md'])
    await expect(runTracked(makeTestGitFs(tracked))).resolves.toBe(tracked)
  })

  it('listTrackedFiles() fails with the supplied GitUnavailableError', async () => {
    const error = new GitUnavailableError({ base: '/base', message: 'boom' })
    const reported = await runTrackedFailure(makeTestGitFs(error))
    expect(reported).toBe(error)
  })

  it('listIgnoredDirs() defaults to empty when not supplied', async () => {
    const result = await runIgnoredDirs(makeTestGitFs(new Set()))
    expect(result).toEqual([])
  })

  it('listIgnoredDirs() reports the supplied dirs', async () => {
    const dirs = ['/base/node_modules', '/base/dist']
    const result = await runIgnoredDirs(makeTestGitFs(new Set(), dirs))
    expect(result).toBe(dirs)
  })

  it('listIgnoredDirs() fails with a supplied GitUnavailableError, independent of listTrackedFiles', async () => {
    const error = new GitUnavailableError({ base: '/base', message: 'ignored-dirs boom' })
    const reported = await runIgnoredDirsFailure(makeTestGitFs(new Set(), error))
    expect(reported).toBe(error)
    // The two methods fail independently — listTrackedFiles on the SAME
    // layer still succeeds, proving one isn't accidentally wired to the
    // other's failure.
    const trackedResult = await runTracked(makeTestGitFs(new Set(['/base/x.md']), error))
    expect(trackedResult).toBeInstanceOf(Set)
  })

  it('listWorktreeDirs() defaults to empty when not supplied', async () => {
    const result = await runWorktreeDirs(makeTestGitFs(new Set()))
    expect(result).toEqual([])
  })

  it('listWorktreeDirs() reports the supplied dirs', async () => {
    const dirs = ['/base/.claude/worktrees/some-branch']
    const result = await runWorktreeDirs(makeTestGitFs(new Set(), [], dirs))
    expect(result).toBe(dirs)
  })

  it('listWorktreeDirs() fails with a supplied GitUnavailableError, independent of the other two methods', async () => {
    const error = new GitUnavailableError({ base: '/base', message: 'worktree-dirs boom' })
    const reported = await runWorktreeDirsFailure(makeTestGitFs(new Set(), [], error))
    expect(reported).toBe(error)
    const trackedResult = await runTracked(makeTestGitFs(new Set(['/base/x.md']), [], error))
    expect(trackedResult).toBeInstanceOf(Set)
    const ignoredResult = await runIgnoredDirs(makeTestGitFs(new Set(), ['/base/dist'], error))
    expect(ignoredResult).toEqual(['/base/dist'])
  })
})
