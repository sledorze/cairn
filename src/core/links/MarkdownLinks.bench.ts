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

// Issue #180: `stripCode`'s inline-code masking (`maskInlineCode`) is a
// whole-document backtick-RUN pairing pass, not the single-line regex it
// replaced — worst case O(runs²) when many runs never find a same-length
// partner (see that function's own comment). Neither `smallDoc`/`largeDoc`
// above exercises this at all (zero inline code spans, only fenced blocks),
// so a regression here would be invisible to the existing `stripCode()`
// bench group — this doc gives `bench-guard.sh`'s pre-push comparison a
// real, representative case for the code path this issue actually touched.
const makeInlineCodeDoc = (spanCount: number): string => {
  const lines: string[] = []
  for (let i = 0; i < spanCount; i++) {
    // Common case: normally-paired spans, roughly half wrapped across a
    // line break (the exact shape issue #180 reports), interleaved with a
    // real link so masking has something to protect.
    if (i % 2 === 0) {
      lines.push(`Command \`docker run --rm -it image-${i}\`, then [ref ${i}](../real/dir-${i}/file-${i}.md).`)
    } else {
      lines.push(`Command \`docker run\n--rm -it image-${i}\`, then [ref ${i}](../real/dir-${i}/file-${i}.md).`)
    }
  }
  return lines.join('\n')
}

// Adversarial case: many backtick runs that NEVER find a same-length
// partner — the actual O(runs²) worst case, not just the common paired one.
const makeUnpairedBacktickDoc = (runCount: number): string => {
  const lines: string[] = []
  for (let i = 0; i < runCount; i++) {
    // A run length cycling 1..4 means most runs never match their
    // immediate neighbour, forcing the pairing scan to search further
    // ahead — the shape that actually stresses `skipUntil`'s forward scan.
    lines.push(`${'`'.repeat((i % 4) + 1)  }stray-${i} `)
  }
  return lines.join('')
}

const smallInlineCodeDoc = makeInlineCodeDoc(20)
const largeInlineCodeDoc = makeInlineCodeDoc(500)
const unpairedBacktickDoc = makeUnpairedBacktickDoc(2000)

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

  bench('20 inline code spans (issue #180 shape, some wrapped)', () => {
    stripCode(smallInlineCodeDoc)
  })

  bench('500 inline code spans (issue #180 shape, some wrapped)', () => {
    stripCode(largeInlineCodeDoc)
  })

  bench('2000 never-pairing backtick runs (worst-case pairing search)', () => {
    stripCode(unpairedBacktickDoc)
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
