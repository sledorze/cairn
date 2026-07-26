// Measures the actual new I/O cost the sidecar move introduces: `checkSummaries`
// now does an extra `dfs.listFiles([metaRoot])` + one `readFile` per sidecar
// (`readStamps`), on top of the markdown read `planSummaries()`'s own bench
// (`SummaryTree.bench.ts`) already covers. This is the realistic end-to-end path
// (`cairn check`), not just the pure planner, so it's the number that matters for
// "does the sidecar move keep things fast."

import { Effect } from 'effect'
import { bench, describe } from 'vitest'

import { hashContent } from '../../core/hashing.ts'
import { isSummaryFile, summaryPathFor } from '../../core/summaries/DocSummaries.ts'
import { DIR_SUMMARY, isDirSummary } from '../../core/summaries/SummaryTree.ts'
import { serializeStamp, STAMP_VERSION } from '../../core/summaries/StampStore.ts'
import { isSidecarPath, metaRootFor, sidecarPathFor } from '../../core/sidecar.ts'
import type { TestFile } from '../../io/DocsFs.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkSummaries } from './CheckSummaries.ts'

interface TreeShape {
  readonly depth: number
  readonly dirsPerLevel: number
  readonly filesPerDir: number
  readonly root: string
}

const bigContent = (seed: string): string =>
  Array.from({ length: 40 }, (_, i) => `${seed} body line ${i} with some representative prose content`).join('\n')

const smallContent = (seed: string): string => `${seed} short note`

const tf = (content: string): TestFile => ({ content, mtimeMs: 0 })

/** A fully link-complete, fully sidecar-stamped tree, as `makeTestDocsFs` fixture
 * data — the "steady state" `cairn check` sees on a clean repo. */
const buildFreshFixture = (
  base: string,
  { depth, dirsPerLevel, filesPerDir, root }: TreeShape,
): Record<string, TestFile> => {
  const files: Record<string, TestFile> = {}
  const layout = { base, metaRoot: metaRootFor(base) }

  const visit = (dir: string, level: number): void => {
    const docTargets: string[] = []
    const inputs: string[] = []
    for (let f = 0; f < filesPerDir; f++) {
      const docPath = `${dir}/doc-${f}.md`
      const big = f % 3 !== 0
      const content = big ? bigContent(docPath) : smallContent(docPath)
      files[docPath] = tf(content)
      docTargets.push(docPath)
      if (big) {
        const sp = summaryPathFor(docPath)
        files[sp] = tf(`# summary\n\nSee [source](./${docPath.slice(dir.length + 1)}).`)
        files[sidecarPathFor(sp, layout)] = tf(serializeStamp({ sha256: hashContent(content), version: STAMP_VERSION }))
        inputs.push(sp)
      } else {
        inputs.push(docPath)
      }
    }

    const dirTargets: string[] = []
    if (level < depth) {
      for (let d = 0; d < dirsPerLevel; d++) {
        const sub = `${dir}/sub-${d}`
        visit(sub, level + 1)
        dirTargets.push(sub)
        inputs.push(`${sub}/${DIR_SUMMARY}`)
      }
    }

    const manifest = inputs
      .map((input) => `${input.slice(dir.length + 1)}:${hashContent(files[input]?.content ?? '')}`)
      .toSorted()
      .join('\n')
    const links = [...docTargets, ...dirTargets].map((t) => `- [link](${t.slice(dir.length + 1)})`).join('\n')
    const dsp = `${dir}/${DIR_SUMMARY}`
    files[dsp] = tf(links)
    files[sidecarPathFor(dsp, layout)] = tf(serializeStamp({ sha256: hashContent(manifest), version: STAMP_VERSION }))
  }

  visit(root, 0)
  return files
}

/** Same source docs, no summaries and no `.cairn/**` sidecars anywhere yet —
 * the "first run" worst case. */
const sourceOnly = (files: Record<string, TestFile>, metaRoot: string): Record<string, TestFile> =>
  Object.fromEntries(
    Object.entries(files).filter(([p]) => !isSummaryFile(p) && !isDirSummary(p) && !isSidecarPath(p, metaRoot)),
  )

const BASE = '/repo'
const SMALL: TreeShape = { depth: 1, dirsPerLevel: 9, filesPerDir: 10, root: '/repo/docs' }
const LARGE: TreeShape = { depth: 4, dirsPerLevel: 3, filesPerDir: 16, root: '/repo/docs' }

const metaRoot = metaRootFor(BASE)
const smallFresh = buildFreshFixture(BASE, SMALL)
const smallRaw = sourceOnly(smallFresh, metaRoot)
const largeFresh = buildFreshFixture(BASE, LARGE)
const largeRaw = sourceOnly(largeFresh, metaRoot)

const run = (files: Record<string, TestFile>, roots: readonly string[]): Promise<unknown> => {
  const program = checkSummaries({ base: BASE, roots, thresholdLines: 30 })
  const layer = makeTestDocsFs(files)
  return Effect.runPromise(program.pipe(Effect.provide(layer)))
}

describe('checkSummaries() (real end-to-end path, sidecar I/O included)', () => {
  bench('~100 files, first run (no summaries, no .cairn/**)', async () => {
    await run(smallRaw, [SMALL.root])
  })

  bench('~100 files, steady state (fully stamped, sidecars read from .cairn/**)', async () => {
    await run(smallFresh, [SMALL.root])
  })

  bench('~2000 files, first run (no summaries, no .cairn/**)', async () => {
    await run(largeRaw, [LARGE.root])
  })

  bench('~2000 files, steady state (fully stamped, sidecars read from .cairn/**)', async () => {
    await run(largeFresh, [LARGE.root])
  })
})
