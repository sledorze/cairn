import * as crypto from 'node:crypto'
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
import { checkRefs, stampRefs } from './CheckRefs.ts'

// Real Node filesystem (DocsFsLive), matching CheckLinks.integration.test.ts's
// own discipline: the manual dogfooding proof (edit src/core/glob.ts, watch
// docs/architecture.md flip from "References OK" to "possibly stale," revert,
// confirm clean again) converted into a permanent, repeatable test instead of
// a one-shot manual run.

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

describe('stampRefs() / checkRefs() against the real filesystem (DocsFsLive)', () => {
  it('BEFORE/AFTER: stamped and clean, then a real edit to the referenced source file is caught as stale, then reverting clears it again', async () => {
    const p = project('checkrefs-drift', {
      'docs/index.md': '[core](../src/engine.ts)',
      'src/engine.ts': 'export const x = 1\n',
    })
    const args = { base: p.root, roots: [path.join(p.root, 'docs')] }

    const stampResult = await run(stampRefs(args))
    expect(stampResult.stamped).toBe(1)

    const before = await run(checkRefs(args))
    expect(before.checked).toBe(1)
    expect(before.stale).toEqual([])

    // A real, later change to the referenced file — same shape as editing
    // src/core/glob.ts underneath docs/architecture.md's real link.
    p.write('src/engine.ts', 'export const x = 2 // real change\n')

    const after = await run(checkRefs(args))
    expect(after.stale).toHaveLength(1)
    expect(after.stale[0]?.file).toBe(path.join(p.root, 'docs', 'index.md'))
    expect(after.stale[0]?.refs).toEqual([
      {
        currentHash: expect.any(String),
        recordedHash: expect.any(String),
        target: '../src/engine.ts',
        targetKindGuidance: [],
      },
    ])
    expect(after.stale[0]?.refs[0]?.currentHash).not.toBe(after.stale[0]?.refs[0]?.recordedHash)

    p.write('src/engine.ts', 'export const x = 1\n')
    const reverted = await run(checkRefs(args))
    expect(reverted.stale).toEqual([])
  })

  it('tracks several real references in one doc independently — mirrors the real docs/architecture.md shape (10+ links in one file)', async () => {
    const p = project('checkrefs-multi', {
      'docs/guide.md': '# Guide\n\n## Getting Started\n',
      'docs/index.md': [
        '[a](../src/a.ts)',
        '[b](../src/b.ts)',
        '[c](../src/c.ts)',
        '[guide](./guide.md#getting-started)',
      ].join('\n'),
      'src/a.ts': 'export const a = 1\n',
      'src/b.ts': 'export const b = 1\n',
      'src/c.ts': 'export const c = 1\n',
    })
    const args = { base: p.root, roots: [path.join(p.root, 'docs')] }

    await run(stampRefs(args))
    const before = await run(checkRefs(args))
    expect(before.stale).toEqual([])

    // Change only b.ts on real disk — a.ts/c.ts/the guide anchor must stay silent.
    p.write('src/b.ts', 'export const b = 2 // changed\n')
    const afterB = await run(checkRefs(args))
    expect(afterB.stale).toHaveLength(1)
    expect(afterB.stale[0]?.refs.map((r) => r.target)).toEqual(['../src/b.ts'])

    // Now also change c.ts — both, and only both, drifted refs are reported,
    // each correctly paired with its own real hash.
    p.write('src/c.ts', 'export const c = 2 // also changed\n')
    const afterBoth = await run(checkRefs(args))
    const byTarget = new Map(afterBoth.stale[0]?.refs.map((r) => [r.target, r]))
    expect([...byTarget.keys()].toSorted()).toEqual(['../src/b.ts', '../src/c.ts'])
    expect(byTarget.get('../src/b.ts')?.currentHash).not.toBe(byTarget.get('../src/c.ts')?.currentHash)

    // Revert both — back to fully clean.
    p.write('src/b.ts', 'export const b = 1\n')
    p.write('src/c.ts', 'export const c = 1\n')
    const reverted = await run(checkRefs(args))
    expect(reverted.stale).toEqual([])
  })

  it("does not collide with _SUMMARY.md's own real freshness sidecar (the exact bug caught while dogfooding this feature)", async () => {
    const p = project('checkrefs-summary-collision', {
      '.cairn/docs/_SUMMARY.md.json': '{"sha256":"real-freshness-hash","version":1}',
      'docs/_SUMMARY.md': '- [architecture](./architecture.md)',
      'docs/architecture.md': '# Architecture',
    })
    await run(stampRefs({ base: p.root, roots: [path.join(p.root, 'docs')] }))

    const freshnessSidecarStillIntact = fs.readFileSync(path.join(p.root, '.cairn', 'docs', '_SUMMARY.md.json'), 'utf8')
    expect(freshnessSidecarStillIntact).toBe('{"sha256":"real-freshness-hash","version":1}')

    const refsSidecarPath = path.join(p.root, '.cairn', 'refs', 'docs', '_SUMMARY.md.json')
    expect(fs.existsSync(refsSidecarPath)).toBeTruthy()
  })

  it('checkRefs() treats a corrupt/unparseable refs sidecar as nothing recorded, not a crash', async () => {
    const p = project('checkrefs-corrupt-sidecar', {
      '.cairn/refs/docs/index.md.json': 'not valid json at all {{{',
      'docs/index.md': '[core](../src/engine.ts)',
      'src/engine.ts': 'export const x = 1\n',
    })
    const result = await run(checkRefs({ base: p.root, roots: [path.join(p.root, 'docs')] }))
    // The corrupt sidecar contributes nothing — same as a doc never stamped
    // at all, matching `parseRefs`'s own "corrupt JSON reads as null, never
    // throws" contract.
    expect(result.checked).toBe(0)
    expect(result.stale).toEqual([])
  })

  // Found via adversarial "no unhandled exception" review: a doc that lists
  // fine but can't be READ used to crash the whole run — `dfs.readFile` on
  // the primary scan is `Effect.orDie`-wrapped. Skipped when running as
  // root/Windows (permission bits aren't enforced the same way).
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsPosixPermissions = process.platform !== 'win32' && !isRoot

  it.skipIf(!supportsPosixPermissions)('stampRefs skips a permission-denied doc instead of crashing', async () => {
    const p = project('checkrefs-unreadable', {
      'docs/a.md': '[core](../src/engine.ts)',
      'docs/b.md': '[core](../src/engine.ts)',
      'src/engine.ts': 'export const x = 1\n',
    })
    const bPath = path.join(p.root, 'docs', 'b.md')
    fs.chmodSync(bPath, 0o000)
    try {
      const result = await run(stampRefs({ base: p.root, roots: [path.join(p.root, 'docs')] }))
      expect(result.stamped).toBe(1) // only a.md
      expect(fs.existsSync(path.join(p.root, '.cairn', 'refs', 'docs', 'a.md.json'))).toBeTruthy()
      expect(fs.existsSync(path.join(p.root, '.cairn', 'refs', 'docs', 'b.md.json'))).toBeFalsy()
    } finally {
      fs.chmodSync(bPath, 0o644)
    }
  })

  // Adversarial finding, security-relevant (issue #28's PR, 4th review
  // pass): a symlink physically located INSIDE `base` can still point
  // OUTSIDE it — before this fix, `resolveReferenceContent` hashed and
  // PERSISTED the escaped target's real content into a `.cairn/refs/**`
  // sidecar, a content-fingerprint oracle for arbitrary files reachable
  // via a symlink an attacker could commit inside any scanned root; worse
  // than the plain existence oracle issue #39 was written to close.
  const supportsSymlinks = process.platform !== 'win32'

  it.skipIf(!supportsSymlinks)(
    'never reads or hashes the content of a symlink escaping `base`, even though its own path is lexically in-base',
    async () => {
      const p = project('checkrefs-real-symlink', { 'docs/index.md': '[escape](../escape-link)' })
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkrefs-real-symlink-outside-'))
      const secretFile = path.join(outsideDir, 'secret.txt')
      fs.writeFileSync(secretFile, 'not part of the repo')
      const linkPath = path.join(p.root, 'escape-link')
      try {
        fs.symlinkSync(secretFile, linkPath)
        const args = { base: p.root, roots: [path.join(p.root, 'docs')] }
        const stampResult = await run(stampRefs(args))
        // The doc's only reference is the escaped symlink, which resolves
        // to null (unverifiable) — nothing real to stamp, same as a doc
        // whose only link targets something that never existed at all.
        expect(stampResult.stamped).toBe(0)
        // No sidecar entry recorded a hash for the escaped target — the
        // reference resolves to `null` (unverifiable), same as a target
        // that never existed at all.
        const sidecarPath = path.join(p.root, '.cairn', 'refs', 'docs', 'index.md.json')
        const sidecar = fs.existsSync(sidecarPath) ? fs.readFileSync(sidecarPath, 'utf8') : ''
        expect(sidecar).not.toContain('not part of the repo')
        const secretHash = crypto.createHash('sha256').update('not part of the repo').digest('hex')
        expect(sidecar).not.toContain(secretHash)
      } finally {
        fs.rmSync(outsideDir, { force: true, recursive: true })
      }
    },
  )
})

// Issue #130's real incident, reproduced end to end: a doc's claim about
// package.json#files has no natural [text](path) link target, so nothing
// tracked its drift before this feature — this is the permanent regression
// test converted from docs/design/137-typed-relations/spikes.md's spike 7
// manual dogfooding proof (AGENTS.md: "convert every manual dogfooding proof
// into a permanent test").
describe('stampRefs() / checkRefs() with a declared `cairn-refs` target (issue #130)', () => {
  it('BEFORE/AFTER: package.json changes with no matching link in the doc, still caught as stale, then a doc fix clears it', async () => {
    const p = project('checkrefs-declared', {
      'docs/README.summary.md': [
        'The published tarball ships:',
        '',
        '```cairn-refs',
        '../package.json',
        '```',
        '',
      ].join('\n'),
      'package.json': '{\n  "files": ["dist", "schema"]\n}\n',
    })
    const args = { base: p.root, roots: [path.join(p.root, 'docs')] }

    const stampResult = await run(stampRefs(args))
    expect(stampResult.stamped).toBe(1)

    const before = await run(checkRefs(args))
    expect(before.checked).toBe(1)
    expect(before.stale).toEqual([])

    // The real #130 incident: package.json#files gains an entry; the doc
    // (which never linked package.json at all) is never touched.
    p.write('package.json', '{\n  "files": ["dist", "schema", "CHANGELOG.md"]\n}\n')

    const after = await run(checkRefs(args))
    expect(after.stale).toHaveLength(1)
    expect(after.stale[0]?.file).toBe(path.join(p.root, 'docs', 'README.summary.md'))
    expect(after.stale[0]?.refs).toEqual([
      {
        currentHash: expect.any(String),
        recordedHash: expect.any(String),
        target: '../package.json',
        targetKindGuidance: [],
      },
    ])
    expect(after.stale[0]?.refs[0]?.currentHash).not.toBe(after.stale[0]?.refs[0]?.recordedHash)

    // Re-stamping (the doc author's real fix: "yes, I've now accounted for
    // this change") clears the drift, same as any real link's target.
    const restamp = await run(stampRefs(args))
    expect(restamp.stamped).toBe(1)
    const reverified = await run(checkRefs(args))
    expect(reverified.stale).toEqual([])
  })

  it('a real link and a declared target in the same doc are both tracked, deduped if they name the same target', async () => {
    const p = project('checkrefs-declared-mixed', {
      'docs/index.md': [
        '[core](../src/engine.ts)',
        '',
        '```cairn-refs',
        '../package.json',
        '../src/engine.ts',
        '```',
      ].join('\n'),
      'package.json': '{}\n',
      'src/engine.ts': 'export const x = 1\n',
    })
    const args = { base: p.root, roots: [path.join(p.root, 'docs')] }

    const stampResult = await run(stampRefs(args))
    expect(stampResult.stamped).toBe(1)

    const sidecarPath = path.join(p.root, '.cairn', 'refs', 'docs', 'index.md.json')
    const sidecar = fs.readFileSync(sidecarPath, 'utf8')
    // Exactly two records: the real link and the declared package.json —
    // engine.ts declared a second time is deduped against the real link,
    // not recorded twice.
    expect(sidecar.match(/"target"/g) ?? []).toHaveLength(2)

    p.write('package.json', '{"changed": true}\n')
    const after = await run(checkRefs(args))
    expect(after.stale).toEqual([
      {
        file: path.join(p.root, 'docs', 'index.md'),
        kindGuidance: [],
        refs: [expect.objectContaining({ target: '../package.json' })],
      },
    ])
  })
})

// ADR 0004 Release 1 (issue #101), Real CLI dogfood: reconstructs the
// reporter's actual repro (issue #101 — cairn 0.6.0 on sledorze/falsestart,
// a doc citing 14 implementation files failing on every unrelated edit to
// any of them) at a smaller, real scale — many leaf files cited, one
// exempted via `refs.scope`'s `ignore` unit — confirming editing the
// exempted leaf stays green while editing a NON-exempted cited file still
// fails, without the facade-layer restructure the reporter had to resort to.
describe('stampRefs() / checkRefs() with `refs.scope` (ADR 0004 Release 1, issue #101)', () => {
  it('an "ignore"-scoped leaf never fails on its own edits; a non-exempted leaf still does', async () => {
    const p = project('checkrefs-scope-dogfood', {
      'docs/index.md': [
        '[a](../src/a.ts)',
        '[b](../src/b.ts)',
        '[noisy](../src/noisy.ts)', // the exempted leaf — edited constantly, no claim depends on it
      ].join('\n'),
      'src/a.ts': 'export const a = 1\n',
      'src/b.ts': 'export const b = 1\n',
      'src/noisy.ts': 'export const noisy = 1\n',
    })
    const args = {
      base: p.root,
      roots: [path.join(p.root, 'docs')],
      scope: [{ glob: 'src/noisy.ts', unit: 'ignore' as const }],
    }

    await run(stampRefs(args))
    const before = await run(checkRefs(args))
    expect(before.stale).toEqual([])

    // The reporter's own repro shape: an unrelated edit to the exempted leaf
    // — stays green.
    p.write('src/noisy.ts', 'export const noisy = 2 // constant noisy churn\n')
    const afterNoisy = await run(checkRefs(args))
    expect(afterNoisy.stale).toEqual([])

    // A real, claim-relevant edit to a NON-exempted leaf still fails —
    // `refs.scope` narrows the noise, it doesn't disable the mechanism.
    p.write('src/b.ts', 'export const b = 2 // real change\n')
    const afterB = await run(checkRefs(args))
    expect(afterB.stale).toHaveLength(1)
    expect(afterB.stale[0]?.refs.map((r) => r.target)).toEqual(['../src/b.ts'])
  })
})
