import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DocsFs, makeTestDocsFs } from '../io/DocsFs.ts'
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
          refs: [{ currentHash: 'def456ghijk', recordedHash: 'abc123defgh', target: '../src/x.ts' }],
        },
      ],
    })
    expect(lines[0]).toBe('⚠️  1 possibly stale reference(s):')
    expect(lines).toContain('  docs/index.md')
    expect(lines.at(-1)).toBe('    ~ ../src/x.ts (abc123de → def456gh)')
  })

  it('includes the anchor when present', () => {
    const lines = formatRefsReport({
      checked: 1,
      stale: [
        {
          file: 'docs/index.md',
          refs: [{ anchor: 'intro', currentHash: 'bb', recordedHash: 'aa', target: './guide.md' }],
        },
      ],
    })
    expect(lines.at(-1)).toContain('./guide.md#intro')
  })
})
