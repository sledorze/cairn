import { describe, expect, it } from 'vitest'

import { isWithinBase, toPosix } from './paths.ts'

describe('toPosix()', () => {
  it('converts Windows separators to POSIX', () => {
    expect(toPosix('a\\b\\c.md')).toBe('a/b/c.md')
    expect(toPosix('C:\\docs\\x.md')).toBe('C:/docs/x.md')
  })

  it('leaves POSIX paths unchanged', () => {
    expect(toPosix('/r/docs/a.md')).toBe('/r/docs/a.md')
  })
})

describe('isWithinBase()', () => {
  it('is true for a path directly inside base', () => {
    expect(isWithinBase('/r/docs/a.md', '/r')).toBeTruthy()
  })

  it('is true for base itself', () => {
    expect(isWithinBase('/r', '/r')).toBeTruthy()
  })

  it('is false for a path resolving outside base via `..` traversal', () => {
    expect(isWithinBase('/etc/hostname', '/r')).toBeFalsy()
    expect(isWithinBase('/r/../etc/hostname', '/r')).toBeFalsy()
  })

  it('is false for an absolute path elsewhere on the filesystem, not just a `..`-relative one', () => {
    expect(isWithinBase('/other/x.md', '/r')).toBeFalsy()
  })

  // Adversarial finding: `path.relative(base, candidate)` can legitimately
  // produce a string that STARTS WITH the two characters `..` without being
  // a `..`-parent-traversal segment at all — e.g. a real directory literally
  // named `..weird` sitting INSIDE base. A bare `rel.startsWith('..')` check
  // (string-prefix, not segment-aware) misclassifies this as "escapes base"
  // even though it's a perfectly legitimate in-base path — fail-closed (a
  // real file wrongly treated as unverifiable), not a security bypass, but
  // still a real correctness bug for any caller relying on this to mean
  // "resolves inside base." Must be a path-SEGMENT check, not a string-
  // prefix check.
  it('is true for a legitimate in-base path whose first segment happens to start with the two characters ".."', () => {
    expect(isWithinBase('/r/..weird/file.ts', '/r')).toBeTruthy()
  })

  it('is still false for actual traversal even when a later segment starts with ".."', () => {
    expect(isWithinBase('/etc/..weird/file.ts', '/r')).toBeFalsy()
  })
})
