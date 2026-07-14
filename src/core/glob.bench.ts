import { bench, describe } from 'vitest'

import { globToRegExp, matchesAny, matchesGlob } from './glob.ts'

const DIRS = ['src', 'docs', 'lib', 'packages', 'apps', 'test', 'scripts', 'vendor']
const SUBDIRS = ['core', 'utils', 'components', 'services', 'models', 'fixtures']
const EXTS = ['ts', 'tsx', 'md', 'json', 'css', 'tmp']

const makePaths = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, i) => {
    const dir = DIRS[i % DIRS.length]
    const sub = SUBDIRS[i % SUBDIRS.length]
    const ext = EXTS[i % EXTS.length]
    if (i % 11 === 0) {
      return `${dir}/node_modules/${sub}/pkg-${i}/index.${ext}`
    }
    if (i % 13 === 0) {
      return `${dir}/.git/objects/${i}.pack`
    }
    if (i % 17 === 0) {
      return `dist/${sub}/bundle-${i}.${ext}`
    }
    return `${dir}/${sub}/deep/nested/path/file-${i}.${ext}`
  })

const IGNORE_PATTERNS = ['**/node_modules/**', '**/.git/**', 'dist/**', '**/*.tmp']

const SIMPLE_PATTERN = 'docs/*.md'
const STAR_STAR_PATTERN = 'docs/**/a.md'
const ENCLOSURE_PATTERN = '**/node_modules/**'
const COMPLEX_PATTERN = '**/src/**/*.spec.?s?(x)'

const paths500 = makePaths(500)
const paths5000 = makePaths(5000)

describe('globToRegExp() — compilation cost by pattern complexity', () => {
  bench('simple single-segment pattern', () => {
    globToRegExp(SIMPLE_PATTERN)
  })

  bench('`**` pattern', () => {
    globToRegExp(STAR_STAR_PATTERN)
  })

  bench('`**/dir/**` enclosure pattern', () => {
    globToRegExp(ENCLOSURE_PATTERN)
  })

  bench('longer pattern with mixed wildcards', () => {
    globToRegExp(COMPLEX_PATTERN)
  })
})

describe('matchesGlob() — single call, since it recompiles the regex every time', () => {
  bench('match against a `**/node_modules/**` pattern', () => {
    matchesGlob('src/core/node_modules/pkg/index.ts', ENCLOSURE_PATTERN)
  })

  bench('non-match against a `**/node_modules/**` pattern', () => {
    matchesGlob('src/core/deep/nested/path/file.ts', ENCLOSURE_PATTERN)
  })
})

describe('matchesAny() — scanning cost across candidate-path-list scale', () => {
  bench('~500 paths against the realistic ignore list', () => {
    for (const path of paths500) {
      matchesAny(path, IGNORE_PATTERNS)
    }
  })

  bench('~5000 paths against the realistic ignore list', () => {
    for (const path of paths5000) {
      matchesAny(path, IGNORE_PATTERNS)
    }
  })
})
