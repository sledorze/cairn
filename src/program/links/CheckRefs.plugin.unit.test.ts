import { it as effectIt } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect, it, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags } from '../checks/CheckPlugin.ts'
import { formatRefsReport, refsPlugin } from './CheckRefs.ts'

const CLI: CheckCliFlags = {
  changed: [],
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

describe('refsPlugin.isEnabled()', () => {
  it('is disabled by default — refs is CLI-flag opt-in only, no config field', () => {
    expect(refsPlugin.isEnabled(DEFAULT_CONFIG, CLI)).toBeFalsy()
  })

  it('is enabled exactly when --refs is set', () => {
    expect(refsPlugin.isEnabled(DEFAULT_CONFIG, { ...CLI, refs: true })).toBeTruthy()
  })
})

test('refsPlugin.jsonUnsupportedMessage matches cli.ts’s exact prior message', () => {
  expect(refsPlugin.jsonUnsupportedMessage).toBe('--json cannot be combined with --refs yet')
})

test('refsPlugin.name is "refs"', () => {
  expect(refsPlugin.name).toBe('refs')
})

test('refsPlugin.format() delegates to formatRefsReport()', () => {
  const result = { checked: 1, kindsConfigured: false, stale: [] }
  expect(refsPlugin.format(result, { locale: 'en' })).toEqual(formatRefsReport(result, { locale: 'en' }))
})

// Narrows `refsPlugin.stamp` from `((...) => ...) | undefined` without a `!`
// non-null assertion (forbidden by this repo's lint config) — a plain
// `if`-throw is the idiom this codebase already uses elsewhere for a
// "structurally guaranteed, not statically provable" fact. Module-scoped so
// both `describe('refsPlugin.run()')` (which stamps as setup) and
// `describe('refsPlugin.stamp()')` (which tests it directly) can use it.
const stamp = refsPlugin.stamp
if (stamp === undefined) {
  throw new Error('expected refsPlugin.stamp to be defined')
}

// Adversarial finding (round 2): the original version of these two tests
// asserted `result.checked === 0` against a fixture with nothing EVER
// stamped — `checkRefs` only counts a doc with a pre-existing stamped
// sidecar record (see CheckRefs.ts's own `if (recorded === null) continue`),
// so `checked` was provably 0 regardless of whether roots/ignore/
// trackedFiles were wired correctly at all; a plugin descriptor that
// dropped `roots` entirely or inverted the trackedFiles ternary would still
// have passed. Fixed by actually stamping first (via `refsPlugin.stamp`,
// already exercised by its own describe block below) so `.run()`'s result
// reflects REAL processing, and by giving the trackedFiles test a second,
// untracked stamped doc that would inflate `checked` if filtering broke.
describe('refsPlugin.run()', () => {
  // Adversarial review finding: nothing exercised `refsPlugin.run`'s real
  // wiring of `resolved.checks.coverage?.kinds` into `kindsConfigured` —
  // mutating that one line to a hardcoded `kinds: []` left every prior test
  // in this file green.
  effectIt.effect(
    'reaches checkRefs with resolved.checks.coverage.kinds wired through — kindsConfigured is true when real kinds are configured',
    () =>
      Effect.gen(function* () {
        const layer = makeTestDocsFs({
          '/r/a.md': { content: '# A\n\n[b](./b.md)', mtimeMs: 1 },
          '/r/b.md': { content: '# B', mtimeMs: 1 },
        })
        const resolved = {
          ...DEFAULT_CONFIG,
          checks: {
            ...DEFAULT_CONFIG.checks,
            coverage: {
              exempt: [],
              kinds: [
                { description: 'A test kind.', id: 'test-kind', select: { by: 'path' as const, glob: '**/a.md' } },
              ],
              rules: [],
            },
          },
        }
        const args = { base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'] }
        yield* stamp(args).pipe(Effect.provide(layer))
        const result = yield* refsPlugin.run(args).pipe(Effect.provide(layer))
        expect(result.kindsConfigured).toBeTruthy()
      }),
  )

  // cairn#187 item 2: nothing exercised `refsPlugin.run`'s wiring of
  // `resolved.checks.coverageExplicitlyDisabled` — mutating that one line to
  // a hardcoded `false` would leave every prior test in this file green.
  effectIt.effect('reaches checkRefs with resolved.checks.coverageExplicitlyDisabled wired through', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/a.md': { content: '# A\n\n[b](./b.md)', mtimeMs: 1 },
        '/r/b.md': { content: '# B', mtimeMs: 1 },
      })
      const resolved = {
        ...DEFAULT_CONFIG,
        checks: { ...DEFAULT_CONFIG.checks, coverageExplicitlyDisabled: true },
      }
      const args = { base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'] }
      yield* stamp(args).pipe(Effect.provide(layer))
      const result = yield* refsPlugin.run(args).pipe(Effect.provide(layer))
      expect(result.coverageExplicitlyDisabled).toBeTruthy()
    }),
  )

  it('reaches checkRefs with roots/ignore wired through — a real stamped, undrifted ref reports checked:1, stale:[]', async () => {
    const layer = makeTestDocsFs({
      '/r/a.md': { content: '# A\n\n[b](./b.md)', mtimeMs: 1 },
      '/r/b.md': { content: '# B', mtimeMs: 1 },
    })
    const args = { base: '/r', cli: CLI, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] }
    await Effect.runPromise(stamp(args).pipe(Effect.provide(layer)))
    const result = await Effect.runPromise(refsPlugin.run(args).pipe(Effect.provide(layer)))
    expect(result).toEqual({ checked: 1, coverageExplicitlyDisabled: false, kindsConfigured: false, stale: [] })
  })

  it('reaches checkRefs with trackedFiles narrowing the scanned universe — an untracked-but-stamped doc is excluded from checked', async () => {
    const layer = makeTestDocsFs({
      '/r/a.md': { content: '# A\n\n[b](./b.md)', mtimeMs: 1 },
      '/r/b.md': { content: '# B', mtimeMs: 1 },
      '/r/untracked.md': { content: '# Untracked\n\n[b](./b.md)', mtimeMs: 1 },
    })
    const stampArgs = { base: '/r', cli: CLI, ignore: [], resolved: DEFAULT_CONFIG, roots: ['/r'] }
    await Effect.runPromise(stamp(stampArgs).pipe(Effect.provide(layer)))
    const result = await Effect.runPromise(
      refsPlugin.run({ ...stampArgs, trackedFiles: new Set(['/r/a.md', '/r/b.md']) }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1) // only a.md — untracked.md's own stamped sidecar is excluded
  })

  // ADR 0004 Release 1: closes the ONE gap adversarial review found in the
  // original PR — every other `refs.scope` test exercises `stampRefs`/
  // `checkRefs` directly, bypassing `refsPlugin` entirely, so a future
  // refactor that silently dropped `scope: resolved.refs.scope` from
  // `refsPlugin.run`/`.stamp` (CheckRefs.ts) would still pass every one of
  // them. This test goes through `resolved` (the real decoded-config shape
  // `cli.ts` actually passes), the same boundary `DEFAULT_CONFIG` fixtures
  // above stub away.
  effectIt.effect(
    'reaches stampRefs/checkRefs with `resolved.refs.scope` wired through — an "ignore"-scoped target is never stamped, even though it is otherwise a real, resolvable reference',
    () =>
      Effect.gen(function* () {
        const layer = makeTestDocsFs({
          '/r/a.md': { content: '# A\n\n[b](./b.md)\n[noisy](./noisy.md)', mtimeMs: 1 },
          '/r/b.md': { content: '# B', mtimeMs: 1 },
          '/r/noisy.md': { content: '# Noisy', mtimeMs: 1 },
        })
        const resolved = { ...DEFAULT_CONFIG, refs: { scope: [{ glob: 'noisy.md', unit: 'ignore' as const }] } }
        const args = { base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'] }
        yield* stamp(args).pipe(Effect.provide(layer))
        const result = yield* refsPlugin.run(args).pipe(Effect.provide(layer))
        expect(result).toEqual({ checked: 1, coverageExplicitlyDisabled: false, kindsConfigured: false, stale: [] }) // b.md tracked; noisy.md never recorded

        // A mutant that dropped the `scope` wiring would hash noisy.md
        // whole-file too, and this edit would then report it as stale.
        const dfs = yield* DocsFs.pipe(Effect.provide(layer))
        yield* dfs.writeFile('/r/noisy.md', '# Noisy, changed constantly')
        const after = yield* refsPlugin.run(args).pipe(Effect.provide(layer))
        expect(after.stale).toEqual([])
      }),
  )

  // Adversarial re-review of the test above found it does NOT actually
  // cover `.stamp`'s own wiring, despite its name/comment claiming to:
  // `checkRefs` (driven by `.run`) recomputes `unitFor` independently at
  // check time from the SAME `resolved.refs.scope`, so even if `.stamp`'s
  // wiring were silently dropped and it wrote noisy.md's real content hash
  // into the sidecar, `.run`'s own correct `unitFor` call would still skip
  // comparing it — masking the defect completely (reproduced: deleting only
  // `.stamp`'s `scope: resolved.refs.scope` line left the ENTIRE suite,
  // including the test above, green). This is the specific defect
  // `resolveReferenceContent`'s own doc comment (CheckRefs.ts) calls out as
  // required to prevent: an ignored target must never be read at all. Only
  // inspecting the raw sidecar `.stamp` itself wrote — independent of
  // `.run`'s masking — actually proves `.stamp`'s wiring.
  effectIt.effect(
    'refsPlugin.stamp itself never writes an "ignore"-scoped target into the sidecar (independent of .run\'s own masking recompute)',
    () =>
      Effect.gen(function* () {
        const layer = makeTestDocsFs({
          '/r/a.md': { content: '# A\n\n[noisy](./noisy.md)', mtimeMs: 1 },
          '/r/noisy.md': { content: '# Noisy', mtimeMs: 1 },
        })
        const resolved = { ...DEFAULT_CONFIG, refs: { scope: [{ glob: 'noisy.md', unit: 'ignore' as const }] } }
        const args = { base: '/r', cli: CLI, ignore: [], resolved, roots: ['/r'] }
        yield* stamp(args).pipe(Effect.provide(layer))
        const dfs = yield* DocsFs.pipe(Effect.provide(layer))
        const sidecarExists = yield* dfs.exists('/r/.cairn/refs/a.md.json')
        expect(sidecarExists).toBeFalsy() // a.md's ONLY reference is ignore-scoped — nothing to stamp at all
      }),
  )
})

describe('refsPlugin.stamp()', () => {
  // stampRefs only counts a doc when it has at least one RESOLVABLE
  // reference to record (see CheckRefs.ts's own `records.length > 0`
  // guard) — a doc with zero links contributes nothing to `stamped`, so
  // the fixture needs a real link, not just a doc.
  const FIXTURE = {
    '/r/a.md': { content: '# A\n\n[b](./b.md)', mtimeMs: 1 },
    '/r/b.md': { content: '# B', mtimeMs: 1 },
  }

  it('returns the exact pre-existing English stamp message, with the real stamped count', async () => {
    const layer = makeTestDocsFs(FIXTURE)
    const lines = await Effect.runPromise(
      stamp({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: DEFAULT_CONFIG,
        roots: ['/r'],
      }).pipe(Effect.provide(layer)),
    )
    expect(lines).toEqual(["🔗 Stamped 1 doc(s)' reference hash(es) (.cairn/** sidecar)."])
  })

  it('formats in French when locale is fr', async () => {
    const layer = makeTestDocsFs(FIXTURE)
    const lines = await Effect.runPromise(
      stamp({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: { ...DEFAULT_CONFIG, locale: 'fr' },
        roots: ['/r'],
      }).pipe(Effect.provide(layer)),
    )
    expect(lines).toEqual(['🔗 1 document(s) tamponné(s) (hachage des références, fichier annexe .cairn/**).'])
  })

  // Same `trackedFiles`-narrowing wiring `describe('refsPlugin.run()')`
  // exercises, but on the `stamp` side of the ternary
  // (`trackedFiles === undefined ? {} : { trackedFiles }`) — an untracked
  // doc's link must not get stamped even though it's a real, resolvable
  // reference.
  effectIt.effect('reaches stampRefs with trackedFiles narrowing which docs get stamped', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs(FIXTURE)
      const lines = yield* stamp({
        base: '/r',
        cli: CLI,
        ignore: [],
        resolved: DEFAULT_CONFIG,
        roots: ['/r'],
        trackedFiles: new Set(['/r/b.md']), // a.md itself is untracked
      }).pipe(Effect.provide(layer))
      expect(lines).toEqual(["🔗 Stamped 0 doc(s)' reference hash(es) (.cairn/** sidecar)."])
    }),
  )
})
