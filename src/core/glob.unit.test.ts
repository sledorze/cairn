import { describe, expect, it } from 'vitest'

import { matchesAny, matchesGlob } from './glob.ts'

describe('matchesGlob()', () => {
  it('matches `*` within a single path segment only', () => {
    expect(matchesGlob('docs/a.md', 'docs/*.md')).toBeTruthy()
    expect(matchesGlob('docs/sub/a.md', 'docs/*.md')).toBeFalsy()
  })

  it('matches `**` across path separators', () => {
    expect(matchesGlob('docs/sub/deep/a.md', 'docs/**/a.md')).toBeTruthy()
    expect(matchesGlob('docs/a.md', 'docs/**/a.md')).toBeTruthy()
  })

  it('matches a `**/name` suffix at any depth', () => {
    expect(matchesGlob('/r/docs/CHANGELOG.md', '**/CHANGELOG.md')).toBeTruthy()
    expect(matchesGlob('CHANGELOG.md', '**/CHANGELOG.md')).toBeTruthy()
  })

  it('matches a `**/dir/**` enclosure', () => {
    expect(matchesGlob('/r/x/node_modules/y/z.md', '**/node_modules/**')).toBeTruthy()
    expect(matchesGlob('/r/x/src/y.md', '**/node_modules/**')).toBeFalsy()
  })

  it('escapes regex metacharacters in literals', () => {
    expect(matchesGlob('a+b.md', 'a+b.md')).toBeTruthy()
    expect(matchesGlob('axb.md', 'a+b.md')).toBeFalsy()
  })

  it('supports `?` for a single non-separator char', () => {
    expect(matchesGlob('a1.md', 'a?.md')).toBeTruthy()
    expect(matchesGlob('a/.md', 'a?.md')).toBeFalsy()
  })
})

describe('matchesAny()', () => {
  it('is true when at least one pattern matches', () => {
    expect(matchesAny('/r/docs/CHANGELOG.md', ['**/node_modules/**', '**/CHANGELOG.md'])).toBeTruthy()
    expect(matchesAny('/r/docs/a.md', ['**/node_modules/**', '**/CHANGELOG.md'])).toBeFalsy()
  })

  it('is false for an empty pattern list', () => {
    expect(matchesAny('/r/docs/a.md', [])).toBeFalsy()
  })
})
