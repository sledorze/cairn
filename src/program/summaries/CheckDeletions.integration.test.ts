import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { afterEach } from 'vitest'

import { DocsFsLive } from '../../io/DocsFs.ts'
import { GitFsLive } from '../../io/Git.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { runGit as git } from '../../testSupport/testGit.ts'
import { checkDeletions } from './CheckDeletions.ts'

// Real dogfood: a real git repo (real `git` binary via GitFsLive), a real
// filesystem (real Node binding via DocsFsLive) — not the in-memory doubles
// CheckDeletions.unit.test.ts uses. AGENTS.md's own "Dogfood the actual CLI"
// discipline: unit tests passing is necessary, not sufficient, for a
// feature whose entire point is real git state.

const CheckDeletionsLive = Layer.mergeAll(DocsFsLive, GitFsLive).pipe(Layer.provide(NodeServices.layer))

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

it.layer(CheckDeletionsLive)('checkDeletions() against a real git repository', (layerIt) => {
  layerIt.effect("finds a deleted doc's heading that appears nowhere else in the remaining corpus", () =>
    Effect.gen(function* () {
      const p = project('deletions-real', {
        'docs/kept.md': '# Kept\n\nUnrelated content.',
        'docs/old.md': '### Unique Section\n\nOnly description of this feature anywhere.',
      })
      git(p.root, 'init', '-q')
      git(p.root, 'config', 'user.email', 'test@example.com')
      git(p.root, 'config', 'user.name', 'Test')
      git(p.root, 'add', '.')
      git(p.root, 'commit', '-q', '-m', 'initial')
      fs.rmSync(path.join(p.root, 'docs', 'old.md'))

      const result = yield* checkDeletions({ base: p.root, ref: 'HEAD', roots: [path.join(p.root, 'docs')] })
      expect(result.checked).toBe(1)
      expect(result.findings).toEqual([
        {
          orphanedHeadings: ['### Unique Section'],
          orphanedLinkTargets: [],
          path: path.join(p.root, 'docs', 'old.md'),
        },
      ])
    }),
  )

  // Found via the same "no unhandled exception" discipline as
  // CheckSummaries.integration.test.ts's own equivalent test: a doc that's
  // still part of the REMAINING corpus but can't be READ (permission
  // denied) must be silently excluded from that corpus, not crash the
  // whole run. Skipped when running as root (bypasses Unix permission
  // bits) or on Windows (`chmod` doesn't enforce POSIX bits).
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsPosixPermissions = process.platform !== 'win32' && !isRoot
  layerIt.effect.skipIf(!supportsPosixPermissions)(
    'a permission-denied doc in the remaining corpus is silently excluded, not a crash',
    () =>
      Effect.gen(function* () {
        const p = project('deletions-unreadable', {
          'docs/kept.md': '# Kept\n\n### Shared\n\nStill here.',
          'docs/locked.md': '# Locked',
          'docs/old.md': '### Shared\n\nSame heading, should be considered surviving via kept.md.',
        })
        git(p.root, 'init', '-q')
        git(p.root, 'config', 'user.email', 'test@example.com')
        git(p.root, 'config', 'user.name', 'Test')
        git(p.root, 'add', '.')
        git(p.root, 'commit', '-q', '-m', 'initial')
        const lockedPath = path.join(p.root, 'docs', 'locked.md')
        fs.chmodSync(lockedPath, 0o000)
        fs.rmSync(path.join(p.root, 'docs', 'old.md'))

        try {
          const result = yield* checkDeletions({ base: p.root, ref: 'HEAD', roots: [path.join(p.root, 'docs')] })
          // "### Shared" survives via kept.md (readable) — locked.md being
          // unreadable doesn't crash the run or otherwise affect the result.
          expect(result.checked).toBe(1)
          expect(result.findings).toEqual([])
        } finally {
          fs.chmodSync(lockedPath, 0o644)
        }
      }),
  )
})
