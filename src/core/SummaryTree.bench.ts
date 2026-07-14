import * as nodePath from 'node:path'

import { bench, describe } from 'vitest'

import { hashContent, isSummaryFile, sourceHashTag, summaryPathFor } from './DocSummaries.ts'
import { DIR_SUMMARY, isDirSummary, planSummaries } from './SummaryTree.ts'

const path = nodePath.posix

interface TreeShape {
  readonly depth: number
  readonly dirsPerLevel: number
  readonly filesPerDir: number
  readonly root: string
}

const bigContent = (seed: string): string =>
  Array.from({ length: 40 }, (_, i) => `${seed} body line ${i} with some representative prose content`).join('\n')

const smallContent = (seed: string): string => `${seed} short note`

/** A fully stamped, link-complete tree: `planSummaries` on it reports every node `ok`. */
const buildFreshTree = ({ depth, dirsPerLevel, filesPerDir, root }: TreeShape): Map<string, string> => {
  const files = new Map<string, string>()

  const visit = (dir: string, level: number): void => {
    const docTargets: string[] = []
    const inputs: string[] = []
    for (let f = 0; f < filesPerDir; f++) {
      const docPath = `${dir}/doc-${f}.md`
      const big = f % 3 !== 0
      const content = big ? bigContent(docPath) : smallContent(docPath)
      files.set(docPath, content)
      docTargets.push(docPath)
      if (big) {
        const sp = summaryPathFor(docPath)
        files.set(
          sp,
          `${sourceHashTag(hashContent(content))}\n\n# summary\n\nSee [source](./${path.basename(docPath)}).`,
        )
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
      .map((input) => `${path.relative(dir, input)}:${hashContent(files.get(input) ?? '')}`)
      .toSorted()
      .join('\n')
    const links = [...docTargets, ...dirTargets].map((t) => `- [link](${path.relative(dir, t)})`).join('\n')
    files.set(`${dir}/${DIR_SUMMARY}`, `${sourceHashTag(hashContent(manifest))}\n\n${links}`)
  }

  visit(root, 0)
  return files
}

/** Same source docs, no summaries anywhere yet — the "first run" worst case. */
const sourceOnly = (files: ReadonlyMap<string, string>): Map<string, string> =>
  new Map([...files].filter(([p]) => !isSummaryFile(p) && !isDirSummary(p)))

const SMALL: TreeShape = { depth: 1, dirsPerLevel: 9, filesPerDir: 10, root: '/repo/docs' }
const LARGE: TreeShape = { depth: 4, dirsPerLevel: 3, filesPerDir: 16, root: '/repo/docs' }

const smallFresh = buildFreshTree(SMALL)
const smallRaw = sourceOnly(smallFresh)
const largeFresh = buildFreshTree(LARGE)
const largeRaw = sourceOnly(largeFresh)

describe('planSummaries()', () => {
  bench('~100 files, flat/shallow, first run (no summaries)', () => {
    planSummaries({ files: smallRaw, roots: [SMALL.root] })
  })

  bench('~100 files, flat/shallow, steady state (fully stamped)', () => {
    planSummaries({ files: smallFresh, roots: [SMALL.root] })
  })

  bench('~2000 files, deep/nested, first run (no summaries)', () => {
    planSummaries({ files: largeRaw, roots: [LARGE.root] })
  })

  bench('~2000 files, deep/nested, steady state (fully stamped)', () => {
    planSummaries({ files: largeFresh, roots: [LARGE.root] })
  })
})
