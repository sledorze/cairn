import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { afterEach } from 'vitest'

import { DocsFsLive } from '../../io/DocsFs.ts'
import { GitFs, GitFsLive } from '../../io/Git.ts'
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

  // Issue #106 "best value defaults" audit: a corrupt git object for one
  // DELETED doc (as opposed to the permission-denied CURRENT-corpus case
  // above) must not just degrade gracefully for that one doc — it must be
  // NAMED in `skipped`, matching `CheckLinks.ts`'s own established
  // `unreadable` precedent, not silently absorbed into a smaller `checked`
  // count. Converts the manual dogfooding proof (a real corrupted loose
  // object, chmod'd writable then overwritten with garbage) into a
  // permanent test.
  layerIt.effect('a corrupt git object for one deleted doc is named in `skipped`, not silently absorbed', () =>
    Effect.gen(function* () {
      const p = project('deletions-corrupt-object', {
        'docs/kept.md': '# Kept',
        'docs/old1.md': '### Unique Section One\n\nOnly description of feature one.',
        'docs/old2.md': '### Unique Section Two\n\nOnly description of feature two.',
      })
      git(p.root, 'init', '-q')
      git(p.root, 'config', 'user.email', 'test@example.com')
      git(p.root, 'config', 'user.name', 'Test')
      git(p.root, 'add', '.')
      git(p.root, 'commit', '-q', '-m', 'initial')
      const old2Sha = git(p.root, 'rev-parse', 'HEAD:docs/old2.md').trim()
      const objPath = path.join(p.root, '.git', 'objects', old2Sha.slice(0, 2), old2Sha.slice(2))
      fs.rmSync(path.join(p.root, 'docs', 'old1.md'))
      fs.rmSync(path.join(p.root, 'docs', 'old2.md'))
      fs.chmodSync(objPath, 0o644)
      fs.writeFileSync(objPath, 'garbage, not a real git object')

      const result = yield* checkDeletions({ base: p.root, ref: 'HEAD', roots: [path.join(p.root, 'docs')] })
      const old1Abs = path.join(p.root, 'docs', 'old1.md')
      const old2Abs = path.join(p.root, 'docs', 'old2.md')
      expect(result.checked).toBe(1)
      expect(result.findings).toEqual([
        { orphanedHeadings: ['### Unique Section One'], orphanedLinkTargets: [], path: old1Abs },
      ])
      expect(result.skipped).toEqual([old2Abs])
    }),
  )

  // Issue #106 "best value defaults" audit: `onlyGitTracked` CI parity,
  // matching every sibling check (CheckSummaries.ts etc.) — a real,
  // untracked scratch doc in the REMAINING corpus must not mask a
  // genuinely-orphaned heading once `trackedFiles` narrows the scan,
  // exactly the false negative a fresh CI checkout would never reproduce
  // (an untracked file simply isn't there).
  layerIt.effect(
    'onlyGitTracked (trackedFiles) excludes an untracked scratch doc from the remaining corpus, unmasking the real finding',
    () =>
      Effect.gen(function* () {
        const p = project('deletions-tracked-files', {
          'docs/old.md': '### Unique Section\n\nOnly description of this feature anywhere.',
        })
        git(p.root, 'init', '-q')
        git(p.root, 'config', 'user.email', 'test@example.com')
        git(p.root, 'config', 'user.name', 'Test')
        git(p.root, 'add', '.')
        git(p.root, 'commit', '-q', '-m', 'initial')
        fs.rmSync(path.join(p.root, 'docs', 'old.md'))

        // Untracked — never `git add`-ed. Would otherwise coincidentally
        // "carry" the same heading and mask the real finding.
        fs.writeFileSync(path.join(p.root, 'docs', 'scratch.md'), '### Unique Section')

        const gitFs = yield* GitFs
        const trackedFiles = yield* gitFs.listTrackedFiles(p.root)

        const withoutTracking = yield* checkDeletions({ base: p.root, ref: 'HEAD', roots: [path.join(p.root, 'docs')] })
        expect(withoutTracking.findings).toEqual([])

        const withTracking = yield* checkDeletions({
          base: p.root,
          ref: 'HEAD',
          roots: [path.join(p.root, 'docs')],
          trackedFiles,
        })
        expect(withTracking.findings).toEqual([
          {
            orphanedHeadings: ['### Unique Section'],
            orphanedLinkTargets: [],
            path: path.join(p.root, 'docs', 'old.md'),
          },
        ])
      }),
  )
})
