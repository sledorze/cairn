import { describe, expect, it } from 'vitest'

import { extractDeclaredRefs } from './DeclaredRefs.ts'

describe('extractDeclaredRefs()', () => {
  it('extracts a single declared target from a cairn-refs fence', () => {
    const content = ['Some prose.', '', '```cairn-refs', 'package.json', '```', '', 'More prose.'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  it('extracts several targets, one per line, in order', () => {
    const content = ['```cairn-refs', 'package.json', 'CHANGELOG.md', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([
      { anchor: null, target: 'package.json' },
      { anchor: null, target: 'CHANGELOG.md' },
    ])
  })

  it('splits a #anchor the same way a real link target does', () => {
    const content = ['```cairn-refs', 'package.json#files', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: 'files', target: 'package.json' }])
  })

  it('ignores blank lines and #-comment lines inside the fence', () => {
    const content = ['```cairn-refs', '', '# a comment', 'package.json', '', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  it('dedupes by (target, anchor)', () => {
    const content = ['```cairn-refs', 'package.json', 'package.json', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  it('ignores an ordinary fenced code block with a different or no info string', () => {
    const noInfo = ['```', 'package.json', '```'].join('\n')
    const otherInfo = ['```json', 'package.json', '```'].join('\n')
    expect(extractDeclaredRefs(noInfo)).toEqual([])
    expect(extractDeclaredRefs(otherInfo)).toEqual([])
  })

  it('ignores a URL-scheme target, matching isCheckableTarget elsewhere', () => {
    const content = ['```cairn-refs', 'https://example.com/a', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([])
  })

  it('returns [] for a doc with no cairn-refs fence at all', () => {
    expect(extractDeclaredRefs('Just prose, no fences.')).toEqual([])
  })

  it('treats an unclosed fence as extending to end of document, matching maskFencedCode', () => {
    const content = ['```cairn-refs', 'package.json'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  it('supports the ~~~ fence marker too', () => {
    const content = ['~~~cairn-refs', 'package.json', '~~~'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  // Found by adversarial review: markdownFences.ts's own fence detection is
  // deliberately indentation-blind (safe for masking — over-triggering only
  // masks MORE, never a false enable). This module writes a sidecar entry
  // on a match, so the same permissiveness would be a real false-positive:
  // a 4+-space-indented ```cairn-refs (e.g. a nested bullet illustrating
  // the feature's own syntax) is CommonMark's indented-code-block territory,
  // not a real fence, and must not be treated as a live declaration.
  it('does NOT treat a 4-space-indented fence as a real declaration (CommonMark: indented code, not a fence)', () => {
    const content = ['- an example:', '', '    ```cairn-refs', '    package.json', '    ```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([])
  })

  it('DOES treat a fence indented by up to 3 spaces as real, matching CommonMark', () => {
    const content = ['   ```cairn-refs', '   package.json', '   ```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  it('a mismatched close marker (opened with ```, "closed" with ~~~) never closes the fence — content up to the real close is scanned, including the stray line as a bogus (but harmless) candidate', () => {
    const content = ['```cairn-refs', 'package.json', '~~~', 'CHANGELOG.md', '```'].join('\n')
    // The ~~~ line is not a valid close for a ``` fence (matches
    // maskFencedCode's own isFenceClose contract exactly), so it's scanned
    // as an ordinary body line. `isCheckableTarget` alone (this module's
    // only filter, same as `extractReferences` elsewhere) does not reject
    // it — it's a real, if unusual, gap between "checkable-shaped" and
    // "path-shaped" (`looksLikeRootedPath`'s stricter job in ProseRefs.ts,
    // deliberately not reused here). Harmless downstream: `stampRefs`
    // resolves it against the filesystem and drops it silently, exactly
    // like any other declared target that doesn't exist on disk.
    expect(extractDeclaredRefs(content)).toEqual([
      { anchor: null, target: 'package.json' },
      { anchor: null, target: '~~~' },
      { anchor: null, target: 'CHANGELOG.md' },
    ])
  })

  it('skips a bare #anchor line (empty path — a same-page fragment, treated as a #-comment line, not a real target)', () => {
    const content = ['```cairn-refs', '#getting-started', 'package.json', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  it("skips a bare ?query line (empty path once parseTarget strips the query — doesn't start with # so it isn't caught by the comment check first)", () => {
    const content = ['```cairn-refs', '?foo=bar', 'package.json', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([{ anchor: null, target: 'package.json' }])
  })

  it('is case-sensitive on the info string — "Cairn-Refs" is not "cairn-refs"', () => {
    const content = ['```Cairn-Refs', 'package.json', '```'].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([])
  })

  it('two separate cairn-refs fences in one doc both contribute, deduped across both', () => {
    const content = [
      '```cairn-refs',
      'package.json',
      '```',
      '',
      'More prose.',
      '',
      '```cairn-refs',
      'package.json',
      'CHANGELOG.md',
      '```',
    ].join('\n')
    expect(extractDeclaredRefs(content)).toEqual([
      { anchor: null, target: 'package.json' },
      { anchor: null, target: 'CHANGELOG.md' },
    ])
  })
})
