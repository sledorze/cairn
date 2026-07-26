import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { GitFs, GitFsLive } from '../../io/Git.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { checkSummaries, summaryExitCode } from './CheckSummaries.ts'

// Real dogfood of issue #48's own motivating example: a real git repo (real
// `git` binary via GitFsLive), a real filesystem (real Node binding via
// DocsFsLive) — not the in-memory doubles CheckSummaries.unit.test.ts uses.
// AGENTS.md's own "Dogfood the actual CLI" discipline: unit tests passing is
// necessary, not sufficient, for a feature whose entire point is real git
// state.

const big = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')

const git = (cwd: string, ...args: readonly string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

const projects: TempProject[] = []
const project = (prefix: string, files: Record<string, string> = {}): TempProject => {
  const p = makeTempProject(prefix, files)
  projects.push(p)
  return p
}
afterEach(() => {
  while (projects.length > 0) {
    projects.pop()?.dispose()
  }
})

describe('checkSummaries() + GitFsLive against a real git repository', () => {
  it('an untracked scratch doc is flagged today (onlyGitTracked off, the default) but disappears entirely once trackedFiles filters it out — the issue #48 example', async () => {
    const p = project('git-summaries', { 'docs/committed.md': big })
    git(p.root, 'init', '-q')
    git(p.root, 'config', 'user.email', 'test@example.com')
    git(p.root, 'config', 'user.name', 'Test')
    git(p.root, 'add', 'docs/committed.md')
    git(p.root, 'commit', '-q', '-m', 'initial')

    // The exact scenario from the issue: an in-progress doc, never `git add`-ed.
    p.write('docs/scratch-notes.md', big)

    const withoutTracking = await Effect.runPromise(
      checkSummaries({ base: p.root, roots: [path.join(p.root, 'docs')], thresholdLines: 30 }).pipe(
        Effect.provide(DocsFsLive),
        Effect.provide(NodeServices.layer),
      ),
    )
    const todoPathsWithoutTracking = withoutTracking.todo.map((n) => n.path)
    expect(todoPathsWithoutTracking.some((f) => f.endsWith('scratch-notes.summary.md'))).toBeTruthy()
    expect(summaryExitCode(withoutTracking)).toBe(1)

    const loadTracked = Effect.gen(function* () {
      const gitFs = yield* GitFs
      return yield* gitFs.listTrackedFiles(p.root)
    })
    const trackedFiles = await Effect.runPromise(loadTracked.pipe(Effect.provide(GitFsLive)))

    const withTrackingArgs = {
      base: p.root,
      roots: [path.join(p.root, 'docs')],
      thresholdLines: 30,
      trackedFiles,
    }
    const withTracking = await Effect.runPromise(
      checkSummaries(withTrackingArgs).pipe(Effect.provide(DocsFsLive), Effect.provide(NodeServices.layer)),
    )
    // committed.md still needs its own summary (real gap, unaffected by
    // filtering) — trackedFiles narrows the universe, it doesn't silence
    // genuine problems on files that ARE in scope.
    const todoPathsWithTracking = withTracking.todo.map((n) => n.path)
    expect(todoPathsWithTracking.some((f) => f.endsWith('scratch-notes.summary.md'))).toBeFalsy()
    expect(todoPathsWithTracking.some((f) => f.endsWith('committed.summary.md'))).toBeTruthy()
  })
})
