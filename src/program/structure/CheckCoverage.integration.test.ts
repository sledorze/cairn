import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocsFs } from '../../io/DocsFs.ts'
import { DocsFsLive } from '../../io/DocsFs.ts'
import type { TempProject } from '../../testSupport/tempProject.ts'
import { makeTempProject } from '../../testSupport/tempProject.ts'
import { checkCoverage } from './CheckCoverage.ts'

// Real Node filesystem (DocsFsLive) — proves real path resolution across
// directories, the one thing `makeTestDocsFs`'s in-memory map can't prove
// (CheckCoverage.unit.test.ts already covers every rule/orphan/exempt
// scenario against the in-memory layer).

const run = <A>(eff: Effect.Effect<A, never, DocsFs>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeServices.layer)))

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

const KINDS = [
  { id: 'feature', select: { by: 'path' as const, glob: '**/features/**' } },
  { id: 'decision', select: { by: 'path' as const, glob: '**/decisions/**' } },
]
const RULES = [{ from: 'feature', to: 'decision' }]

describe('checkCoverage() against the real filesystem (DocsFsLive)', () => {
  it('resolves a real cross-directory relative link and reports real coverage/orphan status', async () => {
    const p = project('checkcoverage-real', {
      'decisions/d1.md': '# Decision',
      'features/f1.md': '# Feature\n\n[why](../decisions/d1.md)',
    })
    const result = await run(checkCoverage({ base: p.root, kinds: KINDS, roots: [p.root], rules: RULES }))
    expect(result.checked).toBe(2)
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
  })

  it('reports a real missing-coverage feature and a real orphan decision', async () => {
    const p = project('checkcoverage-real-gaps', {
      'decisions/d1.md': '# Decision, nobody links here',
      'features/f1.md': '# Feature, no links at all',
    })
    const result = await run(checkCoverage({ base: p.root, kinds: KINDS, roots: [p.root], rules: RULES }))
    expect(result.missing).toEqual([
      {
        path: path.join(p.root, 'features/f1.md').split(path.sep).join('/'),
        rule: { from: 'feature', to: 'decision' },
      },
    ])
    expect(result.orphans).toEqual([
      { kinds: ['decision'], path: path.join(p.root, 'decisions/d1.md').split(path.sep).join('/') },
    ])
  })

  // A file that LISTS fine but can't be READ (permission denied) must not
  // crash the whole run — same discipline as every sibling check
  // (CheckLinks.ts, CheckRefs.ts). `makeTestDocsFs`'s in-memory map can't
  // represent an unreadable-but-listed file, so this needs the real
  // filesystem. Skipped when running as root (bypasses permission bits
  // entirely) or on Windows (`chmod` doesn't enforce POSIX bits there).
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsPosixPermissions = process.platform !== 'win32' && !isRoot
  it.skipIf(!supportsPosixPermissions)('skips an unreadable doc instead of crashing the whole scan', async () => {
    const p = project('checkcoverage-real-unreadable', {
      'decisions/d1.md': '# Decision',
      'features/f1.md': '# Feature\n\n[why](../decisions/d1.md)',
    })
    const lockedFile = path.join(p.root, 'features/locked.md')
    fs.writeFileSync(lockedFile, '# Locked, never readable')
    fs.chmodSync(lockedFile, 0o000)
    try {
      const result = await run(checkCoverage({ base: p.root, kinds: KINDS, roots: [p.root], rules: RULES }))
      expect(result.checked).toBe(2) // locked.md silently excluded, not crashed on
      expect(result.missing).toEqual([])
    } finally {
      fs.chmodSync(lockedFile, 0o644)
    }
  })

  // Exercises `DocsFsLive.realPath`'s own failure path for real — the ONE
  // thing `makeTestDocsFs`'s in-memory double can't prove, since its
  // `realPath` never actually calls `fs.realPath` and so never exercises
  // the real binding's `Effect.catch` fallback to `null` on a genuinely
  // unresolvable (nonexistent) path.
  it('reports missing coverage for an external-path rule whose target genuinely does not exist on the real filesystem', async () => {
    const p = project('checkcoverage-real-external-missing', {
      'specs/s1.md': '# Spec\n\n[impl](../src/missing.ts)',
    })
    const specKinds = [{ id: 'spec', select: { by: 'path' as const, glob: '**/specs/**' } }]
    const externalRules = [{ from: 'spec', to: { external: 'path' as const } }]
    const result = await run(checkCoverage({ base: p.root, kinds: specKinds, roots: [p.root], rules: externalRules }))
    expect(result.missing).toEqual([
      {
        path: path.join(p.root, 'specs/s1.md').split(path.sep).join('/'),
        rule: { from: 'spec', to: { external: 'path' } },
      },
    ])
  })

  // Adversarial finding, security-relevant: a symlink physically located
  // INSIDE the checked-out repo can still point OUTSIDE it — the one
  // scenario neither `makeTestDocsFs`'s in-memory map nor a lexical-only
  // `isWithinBase` check can prove, since it needs a REAL symlink resolved
  // by the REAL filesystem. `checkCoverage` must not treat this as
  // satisfying an `{ external: 'path' }` rule, matching the same
  // containment guarantee its own code comment claims.
  const supportsSymlinks = process.platform !== 'win32'
  it.skipIf(!supportsSymlinks)(
    'never treats a symlink whose real target escapes `base` as satisfying an external-path rule',
    async () => {
      const p = project('checkcoverage-real-symlink', {
        'specs/s1.md': '# Spec\n\n[escape](../escape-link)',
      })
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkcoverage-real-symlink-outside-'))
      const secretFile = path.join(outsideDir, 'secret.txt')
      fs.writeFileSync(secretFile, 'not part of the repo')
      const linkPath = path.join(p.root, 'escape-link')
      try {
        fs.symlinkSync(secretFile, linkPath)
        const specKinds = [{ id: 'spec', select: { by: 'path' as const, glob: '**/specs/**' } }]
        const externalRules = [{ from: 'spec', to: { external: 'path' as const } }]
        const result = await run(
          checkCoverage({ base: p.root, kinds: specKinds, roots: [p.root], rules: externalRules }),
        )
        expect(result.missing).toEqual([
          {
            path: path.join(p.root, 'specs/s1.md').split(path.sep).join('/'),
            rule: { from: 'spec', to: { external: 'path' } },
          },
        ])
      } finally {
        fs.rmSync(outsideDir, { force: true, recursive: true })
      }
    },
  )

  // The positive counterpart: a symlink whose real target stays INSIDE
  // `base` is a legitimate reference and must still satisfy the rule —
  // proves the fix is a containment check, not "reject every symlink."
  it.skipIf(!supportsSymlinks)('is satisfied by a symlink whose real target stays inside `base`', async () => {
    const p = project('checkcoverage-real-symlink-inside', {
      'specs/s1.md': '# Spec\n\n[impl](../impl-link)',
      'src/real.ts': 'export const real = 1',
    })
    const linkPath = path.join(p.root, 'impl-link')
    fs.symlinkSync(path.join(p.root, 'src/real.ts'), linkPath)
    const specKinds = [{ id: 'spec', select: { by: 'path' as const, glob: '**/specs/**' } }]
    const externalRules = [{ from: 'spec', to: { external: 'path' as const } }]
    const result = await run(checkCoverage({ base: p.root, kinds: specKinds, roots: [p.root], rules: externalRules }))
    expect(result.missing).toEqual([])
  })
})
