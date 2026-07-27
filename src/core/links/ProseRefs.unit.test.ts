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

  // Found via adversarial dimension-coverage review (not the original test
  // pass): candidacy was decided on the TRIMMED form but the untrimmed text
  // was what got reported — a citation with trailing whitespace inside the
  // backticks (easy to introduce by accident) was checked against a path
  // that could never resolve, a false positive on ordinary input.
  it('trims whitespace inside the backticks before it is ever reported (not just before deciding candidacy)', () => {
    expect(extractProseRefs('See `src/services/auth.ts ` please.')).toEqual([{ text: 'src/services/auth.ts' }])
    expect(extractProseRefs('See ` src/services/auth.ts` please.')).toEqual([{ text: 'src/services/auth.ts' }])
  })

  // Found via the same review: an absolute path is a real filesystem path,
  // not a repo-ROOTED one (the issue's own term) — without this exclusion
  // it silently joined onto `base` and produced a nonsensical suggestion.
  it('excludes an absolute-path-shaped citation — never a "rooted repo path" candidate', () => {
    expect(extractProseRefs('See `/etc/nginx/nginx.conf` for the real config.')).toEqual([])
  })

  // Found via the same review: a backtick-styled citation inside a REAL
  // Markdown link's text is already CheckLinks.ts's concern — double-
  // reporting it (once by the link checker, once again by --prose-refs
  // suggesting the exact link that already exists) undercuts this
  // feature's own "migration aid, not a second parallel checker" purpose.
  it("does not double-extract a backtick citation that is already inside a real Markdown link's text", () => {
    expect(extractProseRefs('See [`src/services/gone.ts`](../src/services/gone.ts) for details.')).toEqual([])
  })

  it('still extracts an UNLINKED citation elsewhere in the same doc as a real link', () => {
    const content = 'See [`src/a.ts`](../src/a.ts) and separately `src/b.ts` in prose.'
    expect(extractProseRefs(content)).toEqual([{ text: 'src/b.ts' }])
  })

  it('does not mistake an image (`![alt](url)`) for a masked link — same masking rule applies', () => {
    expect(extractProseRefs('![`src/diagram.png`](../src/diagram.png)')).toEqual([])
  })

  // A structural sibling of MarkdownLinks.ts's own LINK_RE ReDoS fix, found
  // by auditing for the same unbounded `[^\]]*`/`[^)\s]+` shape elsewhere in
  // the codebase (CodeQL flagged LINK_RE specifically; this one wasn't
  // flagged, but is exploitable the same way — same style/threshold as that
  // fix's regression test).
  it('stays fast scanning prose with many unclosed brackets (no closing `]` anywhere)', () => {
    const adversarial = '\\['.repeat(80_000)
    const start = performance.now()
    extractProseRefs(adversarial)
    const elapsedMs = performance.now() - start
    // Bounded implementation measured ~250ms locally; the UNBOUNDED (pre-fix)
    // shape measured ~5s on this same input — a ~20x gap, so 3s leaves
    // healthy margin for a slower/shared CI runner (matching MarkdownLinks.ts's
    // own ReDoS test, which really did flake once at a tighter threshold)
    // while still reliably catching a regression back to unbounded.
    expect(elapsedMs).toBeLessThan(3000)
  })
})
