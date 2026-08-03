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
import { checkProseRefs } from './CheckProseRefs.ts'

// Real-filesystem proof (issue #47), mirroring CheckLinks.integration.test.ts's
// discipline: the security boundary (never stat anything outside `base`) is
// only genuinely proven against a REAL file the host machine actually has,
// not an in-memory double that could accidentally "work" either way.

const run = <A>(eff: Effect.Effect<A, never, DocsFs>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeServices.layer)))

const checkDocs = (project: TempProject) =>
  run(checkProseRefs({ base: project.root, roots: [path.join(project.root, 'docs')] }))

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

describe('checkProseRefs() against the real filesystem (DocsFsLive)', () => {
  it('never stats/reads anything outside `base` — a real file on this host is still reported unverifiable, never trusted', async () => {
    expect(fs.existsSync('/etc/passwd')).toBeTruthy() // sanity: the test only proves something if this is true

    const p = project('proserefs-security', {
      // Deliberately does NOT start with `.` — a leading-dot citation is
      // already excluded as "not rooted" before this even runs (see
      // ProseRefs.unit.test.ts); this proves the DEEPER defense — an
      // embedded `../` escape inside an otherwise rooted-looking citation —
      // holds too.
      'docs/guide.md': 'See `x/../../../../../../../../etc/passwd` for details.',
    })
    const result = await checkDocs(p)
    const escape = result.broken[0]?.refs.find((r) => r.text === 'x/../../../../../../../../etc/passwd')
    expect(escape?.reason).toBe('unverifiable')
  })

  it('silent for a resolving citation, reports a genuinely moved/deleted one, real disk end to end', async () => {
    const p = project('proserefs-drift', {
      'docs/guide.md': [
        'See `src/services/auth.ts` for the real thing.',
        'Also `src/services/gone.ts`, moved away.',
      ].join('\n'),
      'src/services/auth.ts': 'export {}',
    })
    const result = await checkDocs(p)
    expect(result.broken).toHaveLength(1)
    const refs = result.broken[0]?.refs ?? []
    expect(refs.map((r) => r.text)).toEqual(['src/services/gone.ts'])
    expect(refs[0]?.suggestion).toBe('[`src/services/gone.ts`](../src/services/gone.ts)')
  })

  // False-positive sweep (issue #47's own stated requirement, criterion 6):
  // run the real checker against cairn's OWN real docs/ tree — a genuine,
  // non-synthetic corpus of prose written by a human, not by this feature's
  // own author trying to satisfy it. Any candidate found here that ISN'T a
  // real drifted reference would be a real false positive.
  it("false-positive sweep: flags nothing on cairn's own real docs/ tree", async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..')
    const result = await run(checkProseRefs({ base: repoRoot, roots: [path.join(repoRoot, 'docs')] }))
    if (result.broken.length > 0) {
      const detail = result.broken
        .flatMap((f) => f.refs.map((r) => `${f.file}: \`${r.text}\` (${r.reason})`))
        .join('\n')
      throw new Error(`false-positive sweep found unexpected candidates:\n${detail}`)
    }
    expect(result.broken).toEqual([])
  })

  // Found via adversarial "no unhandled exception" review: a doc that lists
  // fine but can't be READ used to crash the whole run — `dfs.readFile` on
  // the primary scan is `Effect.orDie`-wrapped. Skipped when running as
  // root/Windows (permission bits aren't enforced the same way).
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsPosixPermissions = process.platform !== 'win32' && !isRoot
  it.skipIf(!supportsPosixPermissions)('skips a permission-denied doc instead of crashing', async () => {
    const p = project('proserefs-unreadable', {
      'docs/a.md': 'See `src/gone-a.ts` for details.',
      'docs/b.md': 'See `src/gone-b.ts` for details.',
      // `src/` must exist at the repo root for a candidate's first
      // segment to pass the false-positive guard (see CheckProseRefs.ts's
      // `resolveOne`) — this file itself is otherwise irrelevant.
      'src/present.ts': 'export {}',
    })
    const bPath = path.join(p.root, 'docs', 'b.md')
    fs.chmodSync(bPath, 0o000)
    try {
      const result = await checkDocs(p)
      const flaggedFiles = result.broken.map((f) => f.file)
      expect(flaggedFiles).toContain(path.join(p.root, 'docs', 'a.md'))
      expect(flaggedFiles).not.toContain(bPath)
      // Issue #93 DRY audit, adversarial review: `checked` must count
      // every LISTED file (both a.md and the unreadable b.md), not just
      // the ones actually scanned — a prior refactor pass silently
      // shrunk this to "successfully read" instead, undetected because
      // nothing here asserted `checked` at all.
      expect(result.checked).toBe(2)
    } finally {
      fs.chmodSync(bPath, 0o644)
    }
  })

  // Adversarial finding, security-relevant (issue #28's PR, 4th review
  // pass): a symlink physically located INSIDE `base` can still point
  // OUTSIDE it — before this fix, a bare-backtick citation reaching such a
  // symlink was treated as resolving (no `unverifiable`/`missing` finding),
  // reproducing the exact filesystem-existence oracle issue #47/#39 were
  // written to close, reached through a path that's lexically in-bounds.
  const supportsSymlinks = process.platform !== 'win32'
  it.skipIf(!supportsSymlinks)(
    'never treats a citation reaching a symlink whose real target escapes `base` as resolving, even under a legitimate in-base first segment',
    async () => {
      // `src` (the citation's first path segment) is a REAL in-base
      // directory — this isolates the fix to the DEEPER symlink escape,
      // not just the already-covered first-segment case.
      const p = project('proserefs-real-symlink', {
        'docs/guide.md': 'See `src/escape-link` for details.',
        'src/present.ts': 'export {}',
      })
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proserefs-real-symlink-outside-'))
      const secretFile = path.join(outsideDir, 'secret.txt')
      fs.writeFileSync(secretFile, 'not part of the repo')
      const linkPath = path.join(p.root, 'src', 'escape-link')
      try {
        fs.symlinkSync(secretFile, linkPath)
        const result = await checkDocs(p)
        // Never silently treated as resolving (which pre-fix, it was: the
        // symlink physically "exists" at its own in-base path, and the old
        // code never resolved what it actually points at) — reported as a
        // real, actionable finding instead.
        const escape = result.broken[0]?.refs.find((r) => r.text === 'src/escape-link')
        expect(escape?.reason).toBe('missing')
      } finally {
        fs.rmSync(outsideDir, { force: true, recursive: true })
      }
    },
  )
})
