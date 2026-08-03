import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { GitFs, GitUnavailableError, makeTestGitFs } from './Git.ts'

// makeTestGitFs itself had never been exercised by any test (a real,
// pre-existing gap the coverage ratchet surfaced once issue #63's
// listIgnoredDirs addition grew the file) — this closes it directly, in
// memory, rather than only via the real-git integration test. Each
// `it.layer(makeTestGitFs(...))` block groups the test(s) that share that
// exact configuration — matching this repo's own established
// `it.layer(...)((layerIt) => ...)` convention (see
// Git.integration.test.ts/BenchCliCheck.integration.test.ts), just with a
// dedicated in-memory layer per configuration instead of one real-git layer
// reused across many.

it.layer(makeTestGitFs(new Set(['/base/a.md'])))('listTrackedFiles() reports the supplied set', (layerIt) => {
  layerIt.effect('reports the supplied set', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const result = yield* gitFs.listTrackedFiles('/base')
      expect(result).toEqual(new Set(['/base/a.md']))
    }),
  )
})

it.layer(makeTestGitFs(new GitUnavailableError({ base: '/base', message: 'boom' })))(
  'listTrackedFiles() failure',
  (layerIt) => {
    layerIt.effect('fails with the supplied GitUnavailableError', () =>
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        const reported = yield* Effect.flip(gitFs.listTrackedFiles('/base'))
        expect(reported).toEqual(new GitUnavailableError({ base: '/base', message: 'boom' }))
      }),
    )
  },
)

it.layer(makeTestGitFs(new Set()))('listIgnoredDirs()/listWorktreeDirs()/listDeletedSince() defaults', (layerIt) => {
  layerIt.effect('listIgnoredDirs() defaults to empty when not supplied', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const result = yield* gitFs.listIgnoredDirs('/base')
      expect(result).toEqual([])
    }),
  )

  layerIt.effect('listWorktreeDirs() defaults to empty when not supplied', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const result = yield* gitFs.listWorktreeDirs('/base')
      expect(result).toEqual([])
    }),
  )

  layerIt.effect('listDeletedSince() defaults to empty when not supplied', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const result = yield* gitFs.listDeletedSince('/base', 'HEAD')
      expect(result).toEqual([])
    }),
  )

  layerIt.effect('readFileAtRef() fails (never a silent null) for a path with no recorded content at that ref', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const result = yield* Effect.flip(gitFs.readFileAtRef('/base', 'HEAD', '/base/docs/never-committed.md'))
      expect(result).toBeInstanceOf(GitUnavailableError)
    }),
  )
})

it.layer(makeTestGitFs(new Set(), ['/base/node_modules', '/base/dist']))(
  'listIgnoredDirs() reports the supplied dirs',
  (layerIt) => {
    layerIt.effect('reports the supplied dirs', () =>
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        const result = yield* gitFs.listIgnoredDirs('/base')
        expect(result).toEqual(['/base/node_modules', '/base/dist'])
      }),
    )
  },
)

it.layer(
  makeTestGitFs(new Set(['/base/x.md']), new GitUnavailableError({ base: '/base', message: 'ignored-dirs boom' })),
)('listIgnoredDirs() failure is independent of listTrackedFiles', (layerIt) => {
  layerIt.effect('fails with a supplied GitUnavailableError, independent of listTrackedFiles', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const reported = yield* Effect.flip(gitFs.listIgnoredDirs('/base'))
      expect(reported).toEqual(new GitUnavailableError({ base: '/base', message: 'ignored-dirs boom' }))
      // The two methods fail independently — listTrackedFiles on the SAME
      // layer still succeeds, proving one isn't accidentally wired to the
      // other's failure.
      const tracked = yield* gitFs.listTrackedFiles('/base')
      expect(tracked).toBeInstanceOf(Set)
    }),
  )
})

it.layer(makeTestGitFs(new Set(), [], ['/base/.claude/worktrees/some-branch']))(
  'listWorktreeDirs() reports the supplied dirs',
  (layerIt) => {
    layerIt.effect('reports the supplied dirs', () =>
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        const result = yield* gitFs.listWorktreeDirs('/base')
        expect(result).toEqual(['/base/.claude/worktrees/some-branch'])
      }),
    )
  },
)

it.layer(
  makeTestGitFs(
    new Set(['/base/x.md']),
    ['/base/dist'],
    new GitUnavailableError({ base: '/base', message: 'worktree-dirs boom' }),
  ),
)('listWorktreeDirs() failure is independent of the other two methods', (layerIt) => {
  layerIt.effect('fails with a supplied GitUnavailableError, independent of the other two methods', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const reported = yield* Effect.flip(gitFs.listWorktreeDirs('/base'))
      expect(reported).toEqual(new GitUnavailableError({ base: '/base', message: 'worktree-dirs boom' }))
      const tracked = yield* gitFs.listTrackedFiles('/base')
      expect(tracked).toBeInstanceOf(Set)
      const ignoredDirs = yield* gitFs.listIgnoredDirs('/base')
      expect(ignoredDirs).toEqual(['/base/dist'])
    }),
  )
})

it.layer(makeTestGitFs(new Set(), [], [], new Map([['/base/docs/old.md', '# Old']])))(
  'readFileAtRef() reports the supplied content for a known path',
  (layerIt) => {
    layerIt.effect('reports the supplied content for a known path', () =>
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        const result = yield* gitFs.readFileAtRef('/base', 'HEAD', '/base/docs/old.md')
        expect(result).toBe('# Old')
      }),
    )
  },
)

it.layer(makeTestGitFs(new Set(), [], [], new Map(), ['/base/docs/old.md']))(
  'listDeletedSince() reports the supplied paths',
  (layerIt) => {
    layerIt.effect('reports the supplied paths', () =>
      Effect.gen(function* () {
        const gitFs = yield* GitFs
        const result = yield* gitFs.listDeletedSince('/base', 'HEAD')
        expect(result).toEqual(['/base/docs/old.md'])
      }),
    )
  },
)

it.layer(
  makeTestGitFs(
    new Set(),
    [],
    [],
    new Map(),
    new GitUnavailableError({ base: '/base', message: 'deleted-since boom' }),
  ),
)('listDeletedSince() failure', (layerIt) => {
  layerIt.effect('fails with a supplied GitUnavailableError', () =>
    Effect.gen(function* () {
      const gitFs = yield* GitFs
      const reported = yield* Effect.flip(gitFs.listDeletedSince('/base', 'HEAD'))
      expect(reported).toEqual(new GitUnavailableError({ base: '/base', message: 'deleted-since boom' }))
    }),
  )
})
