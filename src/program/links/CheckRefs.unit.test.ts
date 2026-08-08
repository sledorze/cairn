import { it as effectIt } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { hashContent } from '../../core/hashing.ts'
import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkRefs, formatRefsReport, refsExitCode, stampRefs } from './CheckRefs.ts'

describe('stampRefs() / checkRefs()', () => {
  // Reproduces a real bug caught while dogfooding: `docs/_SUMMARY.md` is
  // BOTH a real, scannable .md file (it links to every child doc — that's
  // the link-completeness invariant) AND the exact node StampStore.ts's
  // `sidecarPathFor` already uses for _SUMMARY.md's OWN freshness sidecar.
  // `stampRefs` must write its refs record somewhere else entirely, or it
  // silently clobbers the freshness stamp `stampSummaries` already wrote.
  it("does not collide with a summary-tree node's own freshness sidecar at the same doc path", async () => {
    const layer = makeTestDocsFs({
      '/r/.cairn/docs/_SUMMARY.md.json': { content: '{"sha256":"real-freshness-hash","version":1}', mtimeMs: 1 },
      '/r/docs/_SUMMARY.md': { content: '- [architecture](./architecture.md)', mtimeMs: 1 },
      '/r/docs/architecture.md': { content: '# Architecture', mtimeMs: 1 },
    })
    await Effect.runPromise(stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))

    const freshnessSidecar = await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        return yield* dfs.readFile('/r/.cairn/docs/_SUMMARY.md.json')
      }).pipe(Effect.provide(layer)),
    )
    expect(freshnessSidecar).toBe('{"sha256":"real-freshness-hash","version":1}')

    const result = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.checked).toBe(1)
  })

  it('records a reference and reports no drift when the target is unchanged', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/index.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    const stamped = await Effect.runPromise(stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(stamped.stamped).toBe(1)

    const result = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.checked).toBe(1)
    expect(result.stale).toEqual([])
    expect(refsExitCode(result)).toBe(0)
  })

  it("detects drift after the SAME layer's target content changes post-stamp — compares against the ORIGINALLY recorded hash, not a silent re-baseline", async () => {
    const layer = makeTestDocsFs({
      '/r/docs/index.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    await Effect.runPromise(stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))

    await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile('/r/src/engine.ts', 'export const x = 2\n')
      }).pipe(Effect.provide(layer)),
    )

    const result = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.stale).toHaveLength(1)
    expect(result.stale[0]?.file).toBe('/r/docs/index.md')
    expect(result.stale[0]?.refs).toHaveLength(1)
    expect(result.stale[0]?.refs[0]?.target).toBe('../src/engine.ts')
    expect(result.stale[0]?.refs[0]?.currentHash).not.toBe(result.stale[0]?.refs[0]?.recordedHash)
    expect(refsExitCode(result)).toBe(1)
  })

  it('tracks several references in the SAME doc independently — one target drifting does not affect the others (the real docs/architecture.md shape)', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': { content: '# Guide\n\n## Getting Started\n', mtimeMs: 1 },
      '/r/docs/index.md': {
        content: [
          '[a](../src/a.ts)',
          '[b](../src/b.ts)',
          '[c](../src/c.ts)',
          '[guide](./guide.md#getting-started)',
        ].join('\n'),
        mtimeMs: 1,
      },
      '/r/src/a.ts': { content: 'export const a = 1\n', mtimeMs: 1 },
      '/r/src/b.ts': { content: 'export const b = 1\n', mtimeMs: 1 },
      '/r/src/c.ts': { content: 'export const c = 1\n', mtimeMs: 1 },
    })
    const stamped = await Effect.runPromise(stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(stamped.stamped).toBe(1) // one sidecar for index.md, carrying all 4 refs

    const before = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(before.stale).toEqual([])

    // Only `b.ts` changes — a and c and the guide anchor must stay silent.
    await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile('/r/src/b.ts', 'export const b = 2 // changed\n')
      }).pipe(Effect.provide(layer)),
    )

    const after = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(after.stale).toHaveLength(1)
    expect(after.stale[0]?.file).toBe('/r/docs/index.md')
    // Exactly the ONE drifted reference — not a, not c, not the guide anchor.
    expect(after.stale[0]?.refs).toEqual([
      {
        currentHash: expect.any(String),
        recordedHash: expect.any(String),
        target: '../src/b.ts',
        targetKindGuidance: [],
      },
    ])

    // Now change a SECOND target too — both, and only both, must be reported,
    // each correctly paired with its OWN target/hash, not cross-mixed.
    await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile('/r/src/c.ts', 'export const c = 2 // also changed\n')
      }).pipe(Effect.provide(layer)),
    )
    const afterTwo = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    const byTarget = new Map(afterTwo.stale[0]?.refs.map((r) => [r.target, r]))
    expect([...byTarget.keys()].toSorted()).toEqual(['../src/b.ts', '../src/c.ts'])
    expect(byTarget.get('../src/b.ts')?.currentHash).not.toBe(byTarget.get('../src/c.ts')?.currentHash)
  })

  it('preserves the anchor on a stale anchor-qualified reference', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/guide.md': { content: '# Guide\n\n## Getting Started\n\nOld text.', mtimeMs: 1 },
      '/r/docs/index.md': { content: '[intro](./guide.md#getting-started)', mtimeMs: 1 },
    })
    await Effect.runPromise(stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.writeFile('/r/docs/guide.md', '# Guide\n\n## Getting Started\n\nNew text.')
      }).pipe(Effect.provide(layer)),
    )

    const result = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.stale[0]?.refs[0]?.anchor).toBe('getting-started')
  })

  it('does not report drift for a target that no longer exists — that is checkLinks\'s "broken", not this one\'s "stale"', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/index.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    await Effect.runPromise(stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        yield* dfs.deleteFile('/r/src/engine.ts')
      }).pipe(Effect.provide(layer)),
    )

    const result = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.stale).toEqual([])
  })

  it('does not stamp a doc with no resolvable references — nothing to compare against later', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/index.md': { content: 'just prose, no links', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.stamped).toBe(0)
  })

  it('checkRefs skips a doc that was never stamped', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/index.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer)))
    expect(result.checked).toBe(0)
    expect(result.stale).toEqual([])
  })
})

describe('formatRefsReport()', () => {
  it('reports success with the checked count', () => {
    expect(formatRefsReport({ checked: 3, stale: [] })).toEqual(['✅ References OK (3 tracked doc(s)).'])
  })

  it('lists stale references with a short hash diff', () => {
    const lines = formatRefsReport({
      checked: 1,
      stale: [
        {
          file: 'docs/index.md',
          kindGuidance: [],
          refs: [
            {
              currentHash: 'def456ghijk',
              recordedHash: 'abc123defgh',
              target: '../src/x.ts',
              targetKindGuidance: [],
            },
          ],
        },
      ],
    })
    expect(lines[0]).toBe('⚠️  1 possibly stale reference(s):')
    expect(lines).toContain('  docs/index.md')
    expect(lines).toContain('    ~ ../src/x.ts (abc123de → def456gh)')
  })

  // Adversarial review finding: the hash-diff list alone never told a
  // contributor HOW to fix it, unlike cli.ts's own `--explain` tip for
  // stale summaries — this closes that gap.
  it('appends a fix hint pointing at the stamp command', () => {
    const lines = formatRefsReport({
      checked: 1,
      stale: [
        {
          file: 'docs/index.md',
          kindGuidance: [],
          refs: [
            {
              currentHash: 'def456ghijk',
              recordedHash: 'abc123defgh',
              target: '../src/x.ts',
              targetKindGuidance: [],
            },
          ],
        },
      ],
    })
    expect(lines.at(-1)).toContain('cairn check --refs --stamp')
  })

  // Exercises the actual RENDER of kindGuidance/targetKindGuidance (not just
  // that checkRefs computes them, covered elsewhere) — coverage gap found by
  // the coverage ratchet itself when this feature first shipped: the data
  // was tested, the report FORMATTING of that data was not.
  it("renders both the citing doc's kindGuidance and a ref's targetKindGuidance", () => {
    const lines = formatRefsReport({
      checked: 1,
      stale: [
        {
          file: 'docs/spec/checkout.md',
          kindGuidance: ['States a behavioral contract for checkout.'],
          refs: [
            {
              currentHash: 'def456ghijk',
              recordedHash: 'abc123defgh',
              target: '../perf/budget.md',
              targetKindGuidance: ['Perf-critical; re-benchmark before accepting drift.'],
            },
          ],
        },
      ],
    })
    expect(lines).toContain('    [kind] States a behavioral contract for checkout.')
    expect(lines).toContain('      [target kind] Perf-critical; re-benchmark before accepting drift.')
    // Order: file -> kindGuidance -> ref line -> that ref's targetKindGuidance.
    const fileIdx = lines.indexOf('  docs/spec/checkout.md')
    const kindIdx = lines.indexOf('    [kind] States a behavioral contract for checkout.')
    const refIdx = lines.findIndex((l) => l.startsWith('    ~ '))
    const targetKindIdx = lines.indexOf('      [target kind] Perf-critical; re-benchmark before accepting drift.')
    expect(fileIdx).toBeLessThan(kindIdx)
    expect(kindIdx).toBeLessThan(refIdx)
    expect(refIdx).toBeLessThan(targetKindIdx)
  })

  it('includes the anchor when present', () => {
    const lines = formatRefsReport({
      checked: 1,
      stale: [
        {
          file: 'docs/index.md',
          kindGuidance: [],
          refs: [
            { anchor: 'intro', currentHash: 'bb', recordedHash: 'aa', target: './guide.md', targetKindGuidance: [] },
          ],
        },
      ],
    })
    expect(lines).toContain('    ~ ./guide.md#intro (aa → bb)')
  })
})

// Found via dimension-coverage review: `onlyGitTracked` bounded summary
// scanning and link-target existence, but `--refs` was never wired to it at
// all — an untracked doc's ref-drift was scanned and stamped to a real
// sidecar on disk regardless, defeating the CI-parity guarantee everywhere
// else in the tool.
describe('trackedFiles (onlyGitTracked composition)', () => {
  it('stampRefs skips an untracked doc entirely — no sidecar written', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/scratch.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      stampRefs({ base: '/r', roots: ['/r/docs'], trackedFiles: new Set() }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(0)
    const sidecarExists = await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        return yield* dfs.exists('/r/.cairn/refs/docs/scratch.md.json')
      }).pipe(Effect.provide(layer)),
    )
    expect(sidecarExists).toBeFalsy()
  })

  it('checkRefs skips an untracked doc entirely — even one with an existing sidecar from before onlyGitTracked was enabled', async () => {
    const layer = makeTestDocsFs({
      '/r/.cairn/refs/docs/scratch.md.json': {
        content: '{"refs":[{"target":"../src/engine.ts","hash":"old-hash"}]}',
        mtimeMs: 1,
      },
      '/r/docs/scratch.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 2\n', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkRefs({ base: '/r', roots: ['/r/docs'], trackedFiles: new Set() }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(0)
    expect(result.stale).toEqual([])
  })

  it('a tracked doc is still scanned/stamped normally', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/index.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    const trackedFiles = new Set(['/r/docs/index.md'])
    const result = await Effect.runPromise(
      stampRefs({ base: '/r', roots: ['/r/docs'], trackedFiles }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(1)
  })
})

// Found via a SECOND, independent adversarial audit of this same
// dimension-coverage pass: `trackedFiles` was wired first, but `ignore` was
// not — a doc matching an `ignore` glob still had its reference hashes
// stamped to a real on-disk sidecar and still got reported as stale.
describe('ignore (found via a second independent audit)', () => {
  it('stampRefs skips an ignored doc entirely — no sidecar written', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/vendor/CHANGELOG.md': { content: '[core](../../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      stampRefs({ base: '/r', ignore: ['**/vendor/**'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(0)
    const sidecarExists = await Effect.runPromise(
      Effect.gen(function* () {
        const dfs = yield* DocsFs
        return yield* dfs.exists('/r/.cairn/refs/docs/vendor/CHANGELOG.md.json')
      }).pipe(Effect.provide(layer)),
    )
    expect(sidecarExists).toBeFalsy()
  })

  it('checkRefs skips an ignored doc entirely — even one with an existing sidecar from before `ignore` was added', async () => {
    const layer = makeTestDocsFs({
      '/r/.cairn/refs/docs/vendor/CHANGELOG.md.json': {
        content: '{"refs":[{"target":"../../src/engine.ts","hash":"old-hash"}]}',
        mtimeMs: 1,
      },
      '/r/docs/vendor/CHANGELOG.md': { content: '[core](../../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 2\n', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkRefs({ base: '/r', ignore: ['**/vendor/**'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(0)
    expect(result.stale).toEqual([])
  })

  it('a non-ignored doc is still scanned/stamped normally', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/index.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      stampRefs({ base: '/r', ignore: ['**/vendor/**'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(1)
  })
})

// ADR 0004 Release 1 (issue #101): `refs.scope`, a per-glob hashing
// granularity for `--refs` targets. `unit: 'ignore'` closes the reported
// repro — a doc citing many noisy leaf files no longer fails on every
// unrelated edit to an exempted one — without needing Release 2's
// export-surface parser at all.
describe('scope (ADR 0004 Release 1, refs.scope)', () => {
  effectIt.effect(
    'a target matching unit: "ignore" is never included in stampRefs\'s sidecar, and its later edits never report drift',
    () =>
      Effect.gen(function* () {
        const layer = makeTestDocsFs({
          '/r/docs/index.md': { content: '[a](../src/a.ts)\n[b](../src/noisy.ts)', mtimeMs: 1 },
          '/r/src/a.ts': { content: 'export const a = 1\n', mtimeMs: 1 },
          '/r/src/noisy.ts': { content: 'export const noisy = 1\n', mtimeMs: 1 },
        })
        const scope = [{ glob: 'src/noisy.ts', unit: 'ignore' as const }]
        yield* stampRefs({ base: '/r', roots: ['/r/docs'], scope }).pipe(Effect.provide(layer))
        const before = yield* checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
        expect(before.checked).toBe(1) // a.ts's sidecar exists; noisy.ts was never recorded

        const dfs = yield* DocsFs.pipe(Effect.provide(layer))
        yield* dfs.writeFile('/r/src/noisy.ts', 'export const noisy = 2 // changed\n')
        const after = yield* checkRefs({ base: '/r', roots: ['/r/docs'], scope }).pipe(Effect.provide(layer))
        expect(after.stale).toEqual([])
      }),
  )

  effectIt.effect(
    'checkRefs never reports a unit: "ignore" target even against a sidecar recorded BEFORE scope was added',
    () =>
      Effect.gen(function* () {
        const layer = makeTestDocsFs({
          '/r/.cairn/refs/docs/index.md.json': {
            content: '{"refs":[{"target":"../src/noisy.ts","hash":"old-hash"}]}',
            mtimeMs: 1,
          },
          '/r/docs/index.md': { content: '[b](../src/noisy.ts)', mtimeMs: 1 },
          '/r/src/noisy.ts': { content: 'export const noisy = 2 // already drifted\n', mtimeMs: 1 },
        })
        const result = yield* checkRefs({
          base: '/r',
          roots: ['/r/docs'],
          scope: [{ glob: 'src/noisy.ts', unit: 'ignore' }],
        }).pipe(Effect.provide(layer))
        expect(result.stale).toEqual([])
      }),
  )

  // Matches `CheckCoverage.unit.test.ts`'s own "never touches the
  // filesystem for X" pattern (issue #39's own discipline): an ignored
  // target must be excluded BEFORE `isSafelyWithinBase`/`realPath` runs, not
  // read-then-discarded.
  effectIt.effect('never calls realPath (isSafelyWithinBase) for an ignored target', () =>
    Effect.gen(function* () {
      const files: Record<string, string> = {
        '/r/docs/index.md': '[b](../src/noisy.ts)',
        '/r/src/noisy.ts': 'export const noisy = 1\n',
      }
      let realPathCalledForNoisy = false
      const service: DocsFsService = {
        deleteFile: () => Effect.succeed(undefined),
        exists: () => Effect.succeed(true),
        listFiles: () => Effect.succeed(Object.keys(files)),
        readFile: (abs) => Effect.succeed(files[abs] ?? ''),
        realPath: (abs) => {
          if (abs.endsWith('noisy.ts')) {
            realPathCalledForNoisy = true
          }
          return Effect.succeed(abs)
        },
        stat: () => Effect.die('not used in this test'),
        writeFile: () => Effect.succeed(undefined),
      }
      const layer = Layer.succeed(DocsFs, service)
      yield* stampRefs({
        base: '/r',
        roots: ['/r/docs'],
        scope: [{ glob: 'src/noisy.ts', unit: 'ignore' }],
      }).pipe(Effect.provide(layer))
      expect(realPathCalledForNoisy).toBeFalsy()
    }),
  )

  effectIt.effect(
    'first-match-wins: an earlier "ignore" group beats a later "whole-file" group covering the same target',
    () =>
      Effect.gen(function* () {
        const layer = makeTestDocsFs({
          '/r/docs/index.md': { content: '[b](../src/noisy.ts)', mtimeMs: 1 },
          '/r/src/noisy.ts': { content: 'export const noisy = 1\n', mtimeMs: 1 },
        })
        yield* stampRefs({
          base: '/r',
          roots: ['/r/docs'],
          scope: [
            { glob: 'src/noisy.ts', unit: 'ignore' },
            { glob: 'src/**', unit: 'whole-file' },
          ],
        }).pipe(Effect.provide(layer))
        const result = yield* checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
        expect(result.checked).toBe(0) // nothing was recorded — no sidecar to check
      }),
  )

  effectIt.effect("no matching scope group preserves today's only behavior — whole-file, drift still detected", () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/index.md': { content: '[b](../src/other.ts)', mtimeMs: 1 },
        '/r/src/other.ts': { content: 'export const other = 1\n', mtimeMs: 1 },
      })
      yield* stampRefs({
        base: '/r',
        roots: ['/r/docs'],
        scope: [{ glob: 'src/noisy.ts', unit: 'ignore' }],
      }).pipe(Effect.provide(layer))
      const dfs = yield* DocsFs.pipe(Effect.provide(layer))
      yield* dfs.writeFile('/r/src/other.ts', 'export const other = 2 // changed\n')
      const result = yield* checkRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
      expect(result.stale).toHaveLength(1)
    }),
  )
})

// Kind-aware stale-ref guidance: reuses `checks.coverage.kinds`' own,
// already-mandatory `description` field as review context on drift — no new
// config surface, no free-text-per-reference field (design's own v1 was
// rejected for exactly that: citation rot, no closed vocabulary). Absent
// `kinds` (the default) preserves today's behavior byte-for-byte.
describe('kind-aware stale-ref guidance', () => {
  const SPEC_KIND = {
    description: 'States a behavioral contract for checkout.',
    id: 'spec',
    select: { by: 'path' as const, glob: '**/spec/**' },
  }
  const PERF_KIND = {
    description: 'Perf-critical; re-benchmark before accepting drift.',
    id: 'perf',
    select: { by: 'path' as const, glob: '**/perf/**' },
  }

  effectIt.effect("surfaces a matching kind's description as guidance on a stale doc", () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/spec/checkout.md': { content: '[impl](../../src/checkout.ts)', mtimeMs: 1 },
        '/r/src/checkout.ts': { content: 'export const checkout = 1\n', mtimeMs: 1 },
      })
      yield* stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
      const dfs = yield* DocsFs.pipe(Effect.provide(layer))
      yield* dfs.writeFile('/r/src/checkout.ts', 'export const checkout = 2 // changed\n')
      const result = yield* checkRefs({ base: '/r', kinds: [SPEC_KIND], roots: ['/r/docs'] }).pipe(
        Effect.provide(layer),
      )
      expect(result.stale[0]?.kindGuidance).toEqual(['States a behavioral contract for checkout.'])
    }),
  )

  effectIt.effect('a stale doc matching NO declared kind gets an empty kindGuidance, not an error', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/random/notes.md': { content: '[impl](../../src/other.ts)', mtimeMs: 1 },
        '/r/src/other.ts': { content: 'export const other = 1\n', mtimeMs: 1 },
      })
      yield* stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
      const dfs = yield* DocsFs.pipe(Effect.provide(layer))
      yield* dfs.writeFile('/r/src/other.ts', 'export const other = 2 // changed\n')
      const result = yield* checkRefs({ base: '/r', kinds: [SPEC_KIND, PERF_KIND], roots: ['/r/docs'] }).pipe(
        Effect.provide(layer),
      )
      expect(result.stale[0]?.kindGuidance).toEqual([])
    }),
  )

  effectIt.effect("a doc matching multiple declared kinds surfaces each one's guidance", () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/spec/perf/budget.md': { content: '[impl](../../../src/hotpath.ts)', mtimeMs: 1 },
        '/r/src/hotpath.ts': { content: 'export const hotpath = 1\n', mtimeMs: 1 },
      })
      yield* stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
      const dfs = yield* DocsFs.pipe(Effect.provide(layer))
      yield* dfs.writeFile('/r/src/hotpath.ts', 'export const hotpath = 2 // changed\n')
      const result = yield* checkRefs({ base: '/r', kinds: [SPEC_KIND, PERF_KIND], roots: ['/r/docs'] }).pipe(
        Effect.provide(layer),
      )
      expect(result.stale[0]?.kindGuidance).toEqual([
        'States a behavioral contract for checkout.',
        'Perf-critical; re-benchmark before accepting drift.',
      ])
    }),
  )

  // Directly answers the adversarial review's IO-cost finding: guidance
  // lookup must cost NOTHING beyond what `checkRefs` already pays when
  // either no kinds are configured (the common case today) or nothing is
  // stale.
  effectIt.effect("reads the citing doc's content ONLY when it is actually stale, never otherwise", () =>
    Effect.gen(function* () {
      const files: Record<string, string> = {
        '/r/docs/spec/checkout.md': '[impl](../../src/checkout.ts)',
        '/r/src/checkout.ts': 'export const checkout = 1\n',
      }
      const readCalls: string[] = []
      const stampedHash = hashContent(files['/r/src/checkout.ts'] as string)
      const service: DocsFsService = {
        deleteFile: () => Effect.succeed(undefined),
        exists: () => Effect.succeed(true),
        listFiles: () => Effect.succeed(Object.keys(files)),
        readFile: (abs) => {
          readCalls.push(abs)
          if (abs.endsWith('.json')) {
            // Real stamped sidecar matching checkout.ts's CURRENT content —
            // this doc has nothing stale.
            return Effect.succeed(`{"refs":[{"target":"../../src/checkout.ts","hash":"${stampedHash}"}]}`)
          }
          return Effect.succeed(files[abs] ?? '')
        },
        realPath: (abs) => Effect.succeed(abs),
        stat: () => Effect.die('not used in this test'),
        writeFile: () => Effect.succeed(undefined),
      }
      const layer = Layer.succeed(DocsFs, service)
      yield* checkRefs({ base: '/r', kinds: [SPEC_KIND], roots: ['/r/docs'] }).pipe(Effect.provide(layer))
      // The sidecar was read (needed regardless), but the DOC's own content
      // (checkout.md) never was — nothing is stale, so no kind lookup ran.
      expect(readCalls.some((c) => c.endsWith('checkout.md'))).toBeFalsy()
    }),
  )

  // A stale doc whose OWN content can't be read (permission denied mid-run,
  // same class of race `readMarkdownCorpus`'s own lenient-skip discipline
  // handles elsewhere) must not crash the kind lookup — treated as "nothing
  // to classify," same as a doc that matches no kind.
  effectIt.effect(
    'a stale doc that becomes unreadable while computing kind guidance gets an empty kindGuidance, not a crash',
    () =>
      Effect.gen(function* () {
        const files: Record<string, string> = {
          '/r/docs/spec/checkout.md': '[impl](../../src/checkout.ts)',
          '/r/src/checkout.ts': 'export const checkout = 1\n',
        }
        const service: DocsFsService = {
          deleteFile: () => Effect.succeed(undefined),
          exists: () => Effect.succeed(true),
          listFiles: () => Effect.succeed(Object.keys(files)),
          readFile: (abs) => {
            if (abs.endsWith('.json')) {
              return Effect.succeed('{"refs":[{"target":"../../src/checkout.ts","hash":"stale-on-purpose"}]}')
            }
            if (abs.endsWith('checkout.md')) {
              return Effect.die(new Error('EACCES: permission denied'))
            }
            return Effect.succeed(files[abs] ?? '')
          },
          realPath: (abs) => Effect.succeed(abs),
          stat: () => Effect.die('not used in this test'),
          writeFile: () => Effect.succeed(undefined),
        }
        const layer = Layer.succeed(DocsFs, service)
        const result = yield* checkRefs({ base: '/r', kinds: [SPEC_KIND], roots: ['/r/docs'] }).pipe(
          Effect.provide(layer),
        )
        expect(result.stale[0]?.kindGuidance).toEqual([])
      }),
  )

  // Generalization: real repo data (docs/adr + docs/design cross-references)
  // showed far more .md-to-.md citations than .md-to-code ones, so kind
  // guidance must work on the TARGET side too, not just the citing side.
  effectIt.effect('also classifies the TARGET when it is itself a kind-matching .md file', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/perf/budget.md': { content: '# Budget', mtimeMs: 1 },
        '/r/docs/spec/checkout.md': { content: '[budget](../perf/budget.md)', mtimeMs: 1 },
      })
      yield* stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
      const dfs = yield* DocsFs.pipe(Effect.provide(layer))
      yield* dfs.writeFile('/r/docs/perf/budget.md', '# Budget, revised')
      const result = yield* checkRefs({ base: '/r', kinds: [SPEC_KIND, PERF_KIND], roots: ['/r/docs'] }).pipe(
        Effect.provide(layer),
      )
      // Both sides classified: the CITING doc (spec) via kindGuidance, the
      // TARGET doc (perf) via the drifted ref's own targetKindGuidance.
      expect(result.stale[0]?.kindGuidance).toEqual(['States a behavioral contract for checkout.'])
      expect(result.stale[0]?.refs[0]?.targetKindGuidance).toEqual([
        'Perf-critical; re-benchmark before accepting drift.',
      ])
    }),
  )

  effectIt.effect('a code target (not .md) never gets targetKindGuidance, even with kinds configured', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/docs/spec/checkout.md': { content: '[impl](../../src/checkout.ts)', mtimeMs: 1 },
        '/r/src/checkout.ts': { content: 'export const checkout = 1\n', mtimeMs: 1 },
      })
      yield* stampRefs({ base: '/r', roots: ['/r/docs'] }).pipe(Effect.provide(layer))
      const dfs = yield* DocsFs.pipe(Effect.provide(layer))
      yield* dfs.writeFile('/r/src/checkout.ts', 'export const checkout = 2 // changed\n')
      const result = yield* checkRefs({ base: '/r', kinds: [SPEC_KIND, PERF_KIND], roots: ['/r/docs'] }).pipe(
        Effect.provide(layer),
      )
      expect(result.stale[0]?.refs[0]?.targetKindGuidance).toEqual([])
    }),
  )
})

describe('ignore-glob-shape (root-relative, issue #102 regression host)', () => {
  // Issue #102: a root-relative pattern with no leading `**/` (the form
  // anyone actually writes) must exclude a file just as reliably as the
  // `**`-prefixed patterns above — regression coverage exercised through
  // the real checker, not just `isIgnored`'s own unit tests.
  it('stampRefs skips a doc matched by a root-relative pattern with no leading **/ (issue #102)', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/SKIP.md': { content: '[core](../src/engine.ts)', mtimeMs: 1 },
      '/r/src/engine.ts': { content: 'export const x = 1\n', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      stampRefs({ base: '/r', ignore: ['SKIP.md'], roots: ['/r/docs'] }).pipe(Effect.provide(layer)),
    )
    expect(result.stamped).toBe(0)
  })
})
