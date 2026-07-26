import { bench, describe } from 'vitest'

import { buildBasenameIndex, checkContent, extractLinkDefinitions, extractLinks, stripCode } from './MarkdownLinks.ts'

const makeDoc = (linkCount: number): string => {
  const lines: string[] = []
  for (let i = 0; i < linkCount; i++) {
    const kind = i % 5
    if (kind === 0) {
      lines.push(`See [section ${i}](#heading-${i}) for details.`)
    } else if (kind === 1) {
      lines.push(`External ref [site ${i}](https://example.com/page/${i}) for more.`)
    } else if (kind === 2) {
      lines.push(`Broken link [doc ${i}](../missing/dir-${i}/file-${i}.md) here.`)
    } else if (kind === 3) {
      lines.push(
        `Reference style [label-${i}][ref-${i}] appears here.`,
        `[ref-${i}]: ../ref-target/dir-${i}/file-${i}.md`,
      )
    } else {
      lines.push(
        '```md',
        `[in code](../should-be-ignored/${i}.md)`,
        '```',
        `Valid link [good ${i}](../real/dir-${i}/file-${i}.md).`,
      )
    }
  }
  return lines.join('\n')
}

const makeAbsPaths = (count: number): string[] => {
  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    paths.push(`/repo/docs/dir-${i % 50}/file-${i}.md`)
  }
  return paths
}

const smallDoc = makeDoc(20)
const largeDoc = makeDoc(500)

const fewPaths = makeAbsPaths(300)
const manyPaths = makeAbsPaths(3000)
const manyPathsIndex = buildBasenameIndex(manyPaths)

const existsAbs = (abs: string): boolean => abs.includes('/real/')

describe('stripCode()', () => {
  bench('20 links', () => {
    stripCode(smallDoc)
  })

  bench('500 links', () => {
    stripCode(largeDoc)
  })
})

describe('extractLinks()', () => {
  bench('20 links', () => {
    extractLinks(smallDoc)
  })

  bench('500 links', () => {
    extractLinks(largeDoc)
  })
})

describe('extractLinkDefinitions()', () => {
  bench('20 links', () => {
    extractLinkDefinitions(smallDoc)
  })

  bench('500 links', () => {
    extractLinkDefinitions(largeDoc)
  })
})

describe('buildBasenameIndex()', () => {
  bench('300 paths', () => {
    buildBasenameIndex(fewPaths)
  })

  bench('3000 paths', () => {
    buildBasenameIndex(manyPaths)
  })
})

describe('checkContent()', () => {
  bench('20 links, no index', () => {
    checkContent({ content: smallDoc, existsAbs, fileAbs: '/repo/docs/dir-0/file.md' })
  })

  bench('500 links, no index', () => {
    checkContent({ content: largeDoc, existsAbs, fileAbs: '/repo/docs/dir-0/file.md' })
  })

  bench('500 links, with 3000-path index', () => {
    checkContent({ content: largeDoc, existsAbs, fileAbs: '/repo/docs/dir-0/file.md', index: manyPathsIndex })
  })
})
