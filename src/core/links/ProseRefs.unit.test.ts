import { describe, expect, it } from 'vitest'

import { extractProseRefs, looksLikeRootedPath } from './ProseRefs.ts'

describe('looksLikeRootedPath()', () => {
  it('accepts a plain rooted path', () => {
    expect(looksLikeRootedPath('src/services/auth.ts')).toBeTruthy()
  })

  it('rejects a string with no path segment at all', () => {
    expect(looksLikeRootedPath('justAWord')).toBeFalsy()
  })

  // Issue #47 criterion 5: a bare filename with an extension but no path
  // segment is a common ordinary word in prose, not a reference.
  it('rejects a bare filename with an extension but no directory segment', () => {
    expect(looksLikeRootedPath('package.json')).toBeFalsy()
    expect(looksLikeRootedPath('.env')).toBeFalsy()
  })

  it('rejects glob/template-shaped strings', () => {
    expect(looksLikeRootedPath('src/*.ts')).toBeFalsy()
    expect(looksLikeRootedPath('src/{a,b}.ts')).toBeFalsy()
    expect(looksLikeRootedPath('src/<name>.ts')).toBeFalsy()
    expect(looksLikeRootedPath('src/?.ts')).toBeFalsy()
  })

  it('rejects a URL-shaped string even though it contains a slash', () => {
    expect(looksLikeRootedPath('https://example.com/a/b')).toBeFalsy()
  })

  it('rejects a multi-word code span (not a path, even with a slash)', () => {
    expect(looksLikeRootedPath('npm install foo/bar')).toBeFalsy()
  })

  it('rejects an empty or whitespace-only string', () => {
    expect(looksLikeRootedPath('')).toBeFalsy()
    expect(looksLikeRootedPath('   ')).toBeFalsy()
  })

  // Found via the real false-positive sweep against this repo's own docs/.
  it('rejects a dot-relative citation — only ROOTED (repo-root-relative) paths are candidates', () => {
    expect(looksLikeRootedPath('../sidecar.ts')).toBeFalsy()
    expect(looksLikeRootedPath('./local.md')).toBeFalsy()
  })

  it('rejects a bare directory/module mention with no filename to check', () => {
    expect(looksLikeRootedPath('core/')).toBeFalsy()
    expect(looksLikeRootedPath('src/services/')).toBeFalsy()
  })
})

describe('extractProseRefs()', () => {
  it('finds a bare-backtick path citation in prose', () => {
    const refs = extractProseRefs('See `src/services/auth.ts` for details.')
    expect(refs).toEqual([{ text: 'src/services/auth.ts' }])
  })

  it('finds several citations, in order, and skips non-path-like code spans', () => {
    const refs = extractProseRefs('See `src/a.ts` and `src/b.ts`, not `package.json` or `justAWord`.')
    expect(refs.map((r) => r.text)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  // Issue #47 criterion 4: fenced blocks are out of scope — a much higher
  // false-positive rate (illustrative paths never meant as real references).
  it('ignores a path-like string inside a FENCED code block', () => {
    const content = ['See `src/a.ts` in prose.', '', '```', '`src/fenced-only.ts`', '```'].join('\n')
    const refs = extractProseRefs(content)
    expect(refs.map((r) => r.text)).toEqual(['src/a.ts'])
  })

  it('ignores a path-like string inside a ~~~ fenced block too', () => {
    const content = ['~~~', '`src/fenced.ts`', '~~~'].join('\n')
    expect(extractProseRefs(content)).toEqual([])
  })

  it('returns the real, unmasked text even when a real Markdown link sits elsewhere in the same doc', () => {
    // Position-preserving: masking machinery is shared with link-checking's
    // stripCode, but this module reads real text back at the same offsets.
    const content = 'See [existing](./x.md) and also `src/services/auth.ts` in prose.'
    expect(extractProseRefs(content)).toEqual([{ text: 'src/services/auth.ts' }])
  })

  it('finds nothing in a doc with no backtick citations', () => {
    expect(extractProseRefs('Just plain prose, no code spans at all.')).toEqual([])
  })
})
