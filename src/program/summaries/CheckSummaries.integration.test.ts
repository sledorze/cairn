import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { it as effectIt } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { GitFs, GitFsLive } from '../../io/Git.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { runGit as git } from '../../testSupport/testGit.ts'
import { checkSummaries, explainSummaries, stampSummaries, summaryExitCode } from './CheckSummaries.ts'

// Real dogfood of issue #48's own motivating example: a real git repo (real
// `git` binary via GitFsLive), a real filesystem (real Node binding via
// DocsFsLive) — not the in-memory doubles CheckSummaries.unit.test.ts uses.
// AGENTS.md's own "Dogfood the actual CLI" discipline: unit tests passing is
// necessary, not sufficient, for a feature whose entire point is real git
// state.

const big = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')

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
    const trackedFiles = await Effect.runPromise(
      loadTracked.pipe(Effect.provide(GitFsLive), Effect.provide(NodeServices.layer)),
    )

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

  // Found via adversarial "no unhandled exception" review: a doc that lists
  // fine but can't be READ (permission denied) used to crash the whole run
  // with a raw internal PlatformError stack trace — `dfs.readFile` on the
  // primary scan is `Effect.orDie`-wrapped. Skipped when running as root
  // (bypasses Unix permission bits) or on Windows (`chmod` doesn't enforce
  // POSIX bits).
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsPosixPermissions = process.platform !== 'win32' && !isRoot

  it.skipIf(!supportsPosixPermissions)(
    'a permission-denied doc is silently excluded from the plan, not a crash',
    async () => {
      const p = project('summaries-unreadable', {
        'docs/a.md': big,
        'docs/b.md': big,
      })
      const bPath = path.join(p.root, 'docs', 'b.md')
      fs.chmodSync(bPath, 0o000)
      try {
        const result = await Effect.runPromise(
          checkSummaries({ base: p.root, roots: [path.join(p.root, 'docs')], thresholdLines: 30 }).pipe(
            Effect.provide(DocsFsLive),
            Effect.provide(NodeServices.layer),
          ),
        )
        const todoPaths = result.todo.map((n) => n.path)
        // a.md is still readable and still correctly flagged; b.md is
        // silently excluded (unreadable) rather than crashing the run.
        expect(todoPaths.some((f) => f.endsWith('a.summary.md'))).toBeTruthy()
        expect(todoPaths.some((f) => f.endsWith('b.summary.md'))).toBeFalsy()
      } finally {
        fs.chmodSync(bPath, 0o644)
      }
    },
  )

  // Issue #142/#154's own "reflexive re-stamping" gap: `--explain` should show
  // a REAL line-count delta since the recorded hash last matched, not just
  // "stale (source changed)" — proven against real git history, not a double.
  effectIt.layer(Layer.mergeAll(DocsFsLive, GitFsLive).pipe(Layer.provide(NodeServices.layer)))(
    'explainSummaries() + real git',
    (layerIt) => {
      layerIt.effect('shows a real line-count delta since the doc was last stamped', () =>
        Effect.gen(function* () {
          // Trailing newline on both revisions, deliberately — git's own
          // numstat otherwise counts a missing-final-newline's last line as
          // both removed and re-added, which would make this test's +2/-0
          // assertion about the real content change harder to reason about.
          const bigContent = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}\n`
          const p = project('git-explain', { 'docs/a.md': bigContent, 'docs/a.summary.md': '# résumé de a' })
          git(p.root, 'init', '-q')
          git(p.root, 'config', 'user.email', 'test@example.com')
          git(p.root, 'config', 'user.name', 'Test')
          git(p.root, 'add', '.')
          git(p.root, 'commit', '-q', '-m', 'initial')

          const args = { base: p.root, roots: [path.join(p.root, 'docs')], thresholdLines: 30 }
          yield* stampSummaries(args)

          // Genuinely change the source and commit it — the sidecar still
          // records the hash of the OLD content.
          p.write('docs/a.md', `${bigContent}more\nlines\n`)
          git(p.root, 'add', 'docs/a.md')
          git(p.root, 'commit', '-q', '-m', 'grew a.md by 2 lines')

          const lines = yield* explainSummaries(args)
          const text = lines.join('\n')
          expect(text).toContain('a.summary.md (stale):')
          expect(text).toMatch(/changed since [0-9a-f]{8}…: \+2\/-0 lines/)
        }),
      )
    },
  )
})
