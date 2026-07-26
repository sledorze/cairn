import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DocsFs, makeTestDocsFs } from '../io/DocsFs.ts'
import { checkSummaries, pruneOrphans, stampSummaries, summaryExitCode } from './CheckSummaries.ts'

// A single, realistic two-level tree run through a whole lifecycle of edits —
// deletion, rename, content change — each verified against the REAL DocsFs
// service (in-memory), not just isolated pure-planner assertions. This is the
// scenario the sidecar redesign exists to get right: as the tree churns, only
// the affected nodes' status should move, and .cairn/** should track exactly
// what's alive.
//
//   /r/docs/a.md (+ a.summary.md)
//   /r/docs/guide/intro.md (+ intro.summary.md)
//   /r/docs/guide/_SUMMARY.md
//   /r/docs/_SUMMARY.md

const big = (seed: string): string => Array.from({ length: 40 }, (_, i) => `${seed} line ${i}`).join('\n')
const tf = (content: string): { content: string; mtimeMs: number } => ({ content, mtimeMs: 0 })
const base = '/r'
const roots = ['/r/docs']

const readAll = (layer: ReturnType<typeof makeTestDocsFs>, paths: readonly string[]): Promise<Map<string, string>> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const dfs = yield* DocsFs
      const out = new Map<string, string>()
      for (const p of paths) {
        const exists = yield* dfs.exists(p)
        if (exists) {
          out.set(p, yield* dfs.readFile(p))
        }
      }
      return out
    }).pipe(Effect.provide(layer)),
  )

const write = (layer: ReturnType<typeof makeTestDocsFs>, path: string, content: string): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const dfs = yield* DocsFs
      yield* dfs.writeFile(path, content)
    }).pipe(Effect.provide(layer)),
  )

const remove = (layer: ReturnType<typeof makeTestDocsFs>, path: string): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const dfs = yield* DocsFs
      yield* dfs.deleteFile(path)
    }).pipe(Effect.provide(layer)),
  )

const stamp = (layer: ReturnType<typeof makeTestDocsFs>) =>
  Effect.runPromise(stampSummaries({ base, roots, thresholdLines: 30 }).pipe(Effect.provide(layer)))

const check = (layer: ReturnType<typeof makeTestDocsFs>) =>
  Effect.runPromise(checkSummaries({ base, roots, thresholdLines: 30 }).pipe(Effect.provide(layer)))

describe('CheckSummaries — full lifecycle over a two-level hierarchy', () => {
  it('deletion, rename, and content-change each affect only the nodes they should', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('- [a](./a.md)\n- [guide](./guide)'),
      '/r/docs/a.md': tf(big('a')),
      '/r/docs/a.summary.md': tf('# a summary'),
      '/r/docs/guide/_SUMMARY.md': tf('- [intro](./intro.md)'),
      '/r/docs/guide/intro.md': tf(big('intro')),
      '/r/docs/guide/intro.summary.md': tf('# intro summary'),
    })

    // --- Step 1: baseline stamp + check is fully green ---
    const s1 = await stamp(layer)
    expect(s1.missing).toEqual([])
    const c1 = await check(layer)
    expect(c1.todo).toEqual([])
    expect(c1.orphans).toEqual([])
    expect(c1.orphanStamps).toEqual([])
    expect(summaryExitCode(c1)).toBe(0)

    // --- Step 2: DELETION — remove the whole guide/ sub-tree's source + summary ---
    await remove(layer, '/r/docs/guide/intro.md')
    await remove(layer, '/r/docs/guide/intro.summary.md')
    // guide/_SUMMARY.md itself is left behind on disk (as a real author might forget to).
    const c2 = await check(layer)
    // guide is no longer a directory with any docs, so its _SUMMARY.md has no
    // expected node at all -> it shows up as an orphan FILE...
    expect(c2.orphans).toContain('/r/docs/guide/_SUMMARY.md')
    // ...and its sidecar (never touched by hand) is a SEPARATE orphan stamp entry.
    expect(c2.orphanStamps).toContain('/r/docs/guide/_SUMMARY.md')
    // intro.summary.md's own sidecar survives even though BOTH intro.md and
    // intro.summary.md were deleted — this is the deletion signal the sidecar
    // design exists to catch.
    expect(c2.orphanStamps).toContain('/r/docs/guide/intro.summary.md')
    // The PARENT (docs/_SUMMARY.md) must go stale too — its manifest no longer
    // includes guide, so its recorded hash (for the old manifest) no longer matches.
    expect(c2.todo.map((n) => n.path)).toContain('/r/docs/_SUMMARY.md')
    // But the UNRELATED a.summary.md must be untouched by any of this.
    expect(c2.todo.map((n) => n.path)).not.toContain('/r/docs/a.summary.md')
    expect(summaryExitCode(c2)).toBe(1)

    // --- Step 3: prune the deletion's aftermath ---
    const removedCount = await Effect.runPromise(
      pruneOrphans({ base, roots, thresholdLines: 30 }).pipe(Effect.provide(layer)),
    )
    expect(removedCount).toBe(3) // 1 orphan file + 2 orphan stamps
    const remaining = await readAll(layer, [
      '/r/docs/guide/_SUMMARY.md',
      '/r/.cairn/docs/guide/_SUMMARY.md.json',
      '/r/.cairn/docs/guide/intro.summary.md.json',
    ])
    expect(remaining.size).toBe(0)

    // Author away the now-stale parent (drop the guide link) and re-stamp.
    await write(layer, '/r/docs/_SUMMARY.md', '- [a](./a.md)')
    const s3 = await stamp(layer)
    expect(s3.missing).toEqual([])
    const c3 = await check(layer)
    expect(c3.todo).toEqual([])
    expect(c3.orphans).toEqual([])
    expect(c3.orphanStamps).toEqual([])

    // --- Step 4: RENAME — a.md -> renamed.md, content byte-identical ---
    const oldFiles = await readAll(layer, ['/r/docs/a.md'])
    const aContent = oldFiles.get('/r/docs/a.md') ?? ''
    await write(layer, '/r/docs/renamed.md', aContent)
    await remove(layer, '/r/docs/a.md')
    await remove(layer, '/r/docs/a.summary.md')
    await write(layer, '/r/docs/_SUMMARY.md', '- [renamed](./renamed.md)')

    const c4 = await check(layer)
    // The old summary's sidecar is now a deleted-source stamp (rename looks like
    // a deletion + an unrelated new file from the planner's point of view).
    expect(c4.orphanStamps).toContain('/r/docs/a.summary.md')
    // renamed.md needs a brand-new summary — reported as missing, not stale.
    const renamedNode = c4.nodes.find((n) => n.path === '/r/docs/renamed.summary.md')
    expect(renamedNode?.status).toBe('missing')
    expect(summaryExitCode(c4)).toBe(1)

    // Author the new summary, prune the old sidecar, re-stamp.
    await write(layer, '/r/docs/renamed.summary.md', '# renamed summary')
    await Effect.runPromise(pruneOrphans({ base, roots, thresholdLines: 30 }).pipe(Effect.provide(layer)))
    const s4 = await stamp(layer)
    expect(s4.missing).toEqual([])
    const c4b = await check(layer)
    expect(c4b.todo).toEqual([])
    expect(c4b.orphanStamps).toEqual([])

    // --- Step 5: CHANGE — edit renamed.md's content only ---
    await write(layer, '/r/docs/renamed.md', `${aContent}\nan added line`)
    const c5 = await check(layer)
    // Only renamed.summary.md goes stale — NOT docs/_SUMMARY.md. This is the
    // sidecar redesign's actual cascade behaviour, not an oversight: a parent's
    // manifest hash is computed over its child's CONTENT BYTES, and
    // renamed.summary.md's bytes haven't changed yet (only its OWN freshness
    // status has). Staleness doesn't propagate on its own; only re-authoring the
    // summary's prose (which changes its bytes) would in turn perturb the
    // parent. This is the same property that makes an edit-then-revert of a
    // child a no-op for the parent (S4) — it's symmetric, not a special case.
    expect(c5.todo.map((n) => n.path)).toEqual(['/r/docs/renamed.summary.md'])
    expect(c5.orphans).toEqual([])
    expect(c5.orphanStamps).toEqual([])

    // Converges to green again in one bottom-up pass.
    await write(layer, '/r/docs/renamed.summary.md', '# renamed summary (updated)')
    const s5 = await stamp(layer)
    expect(s5.missing).toEqual([])
    const c6 = await check(layer)
    expect(c6.todo).toEqual([])
    expect(summaryExitCode(c6)).toBe(0)
  })

  it('a cross-directory MOVE touches both the old and new parent, and both converge independently', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('- [a](./a.md)\n- [sub](./sub)'),
      '/r/docs/a.md': tf(big('a')),
      '/r/docs/a.summary.md': tf('# a summary'),
      '/r/docs/sub/_SUMMARY.md': tf('- [b](./b.md)'),
      '/r/docs/sub/b.md': tf(big('b')),
      '/r/docs/sub/b.summary.md': tf('# b summary'),
    })
    const s0 = await stamp(layer)
    expect(s0.missing).toEqual([])
    const c0 = await check(layer)
    expect(c0.todo).toEqual([])

    // Move a.md from docs/ into docs/sub/ — a real cross-directory move, not a
    // same-directory rename.
    const oldFiles = await readAll(layer, ['/r/docs/a.md'])
    const aContent = oldFiles.get('/r/docs/a.md') ?? ''
    await write(layer, '/r/docs/sub/a.md', aContent)
    await remove(layer, '/r/docs/a.md')
    await remove(layer, '/r/docs/a.summary.md')
    await write(layer, '/r/docs/_SUMMARY.md', '- [sub](./sub)') // old parent: drop the link
    await write(layer, '/r/docs/sub/_SUMMARY.md', '- [b](./b.md)\n- [a](./a.md)') // new parent: add it

    const c1 = await check(layer)
    // OLD parent (docs/_SUMMARY.md) no longer expects a.summary.md as an input,
    // so its manifest hash changed — stale, needing a re-stamp.
    expect(c1.todo.map((n) => n.path)).toContain('/r/docs/_SUMMARY.md')
    // NEW parent (docs/sub/_SUMMARY.md) now expects it too — also stale.
    expect(c1.todo.map((n) => n.path)).toContain('/r/docs/sub/_SUMMARY.md')
    // The moved doc itself needs a fresh summary at its NEW path.
    expect(c1.nodes.find((n) => n.path === '/r/docs/sub/a.summary.md')?.status).toBe('missing')
    // The OLD summary's sidecar is a deleted-source stamp (moved = deleted, from
    // the planner's point of view, same as a same-directory rename).
    expect(c1.orphanStamps).toContain('/r/docs/a.summary.md')
    // The UNRELATED b.summary.md must be untouched by any of this.
    expect(c1.todo.map((n) => n.path)).not.toContain('/r/docs/sub/b.summary.md')

    // Fix: author the summary at its new home, prune the old sidecar, re-stamp.
    await write(layer, '/r/docs/sub/a.summary.md', '# a summary (moved)')
    await Effect.runPromise(pruneOrphans({ base, roots, thresholdLines: 30 }).pipe(Effect.provide(layer)))
    const s1 = await stamp(layer)
    expect(s1.missing).toEqual([])
    const c2 = await check(layer)
    expect(c2.todo).toEqual([])
    expect(c2.orphans).toEqual([])
    expect(c2.orphanStamps).toEqual([])
  })

  it('a doc dropping below the summary threshold orphans its summary AND sidecar, and the parent input switches from summary to doc', async () => {
    const layer = makeTestDocsFs({
      '/r/docs/_SUMMARY.md': tf('- [a](./a.md)'),
      '/r/docs/a.md': tf(big('a')), // over threshold: needs a summary
      '/r/docs/a.summary.md': tf('# a summary'),
    })
    const s0 = await stamp(layer)
    expect(s0.missing).toEqual([])
    const c0 = await check(layer)
    expect(c0.todo).toEqual([])

    // Shrink a.md below the 30-line threshold — it no longer needs a summary at all.
    await write(layer, '/r/docs/a.md', 'one short line')
    const c1 = await check(layer)
    // The parent's manifest now expects a.md itself (not a.summary.md) as its
    // input, so its recorded hash (computed against the OLD manifest) mismatches.
    expect(c1.todo.map((n) => n.path)).toContain('/r/docs/_SUMMARY.md')
    // a.summary.md is no longer an expected node at all -> orphan file...
    expect(c1.orphans).toContain('/r/docs/a.summary.md')
    // ...and its sidecar is a separate, independent orphan stamp.
    expect(c1.orphanStamps).toContain('/r/docs/a.summary.md')

    // Fix: drop the now-unnecessary summary file, prune its sidecar, re-stamp.
    await remove(layer, '/r/docs/a.summary.md')
    await Effect.runPromise(pruneOrphans({ base, roots, thresholdLines: 30 }).pipe(Effect.provide(layer)))
    const s1 = await stamp(layer)
    expect(s1.missing).toEqual([])
    const c2 = await check(layer)
    expect(c2.todo).toEqual([])
    expect(c2.orphanStamps).toEqual([])
  })
})
