import { describe, expect, it } from 'vitest'

import { isIgnored, isInScope, isWithinBase, relativeToBase, toPosix } from './paths.ts'

describe('toPosix()', () => {
  it('converts Windows separators to POSIX', () => {
    expect(toPosix('a\\b\\c.md')).toBe('a/b/c.md')
    expect(toPosix('C:\\docs\\x.md')).toBe('C:/docs/x.md')
  })

  it('leaves POSIX paths unchanged', () => {
    expect(toPosix('/r/docs/a.md')).toBe('/r/docs/a.md')
  })
})

describe('isInScope()', () => {
  it('is true for a root itself', () => {
    expect(isInScope('/r/docs', ['/r/docs'])).toBeTruthy()
  })

  it('is true for a path under a root', () => {
    expect(isInScope('/r/docs/a.md', ['/r/docs'])).toBeTruthy()
  })

  it('is false for a sibling path that merely shares the root as a string prefix', () => {
    expect(isInScope('/r/docs-other/a.md', ['/r/docs'])).toBeFalsy()
  })

  it('is false for a path outside every configured root', () => {
    expect(isInScope('/r/other/a.md', ['/r/docs'])).toBeFalsy()
  })

  it('is true when any of several roots matches', () => {
    expect(isInScope('/r/b/a.md', ['/r/a', '/r/b'])).toBeTruthy()
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

describe('relativeToBase()', () => {
  it('expresses a candidate inside base as a root-relative POSIX path', () => {
    expect(relativeToBase('/r/.agents/notes.md', '/r')).toBe('.agents/notes.md')
  })

  it('returns base itself as an empty relative path', () => {
    expect(relativeToBase('/r', '/r')).toBe('')
  })

  it('falls back to the candidate itself (as POSIX) when it is not within base', () => {
    expect(relativeToBase('/other/x.md', '/r')).toBe('/other/x.md')
  })
})

describe('isIgnored()', () => {
  it('is false when no ignore patterns are configured', () => {
    expect(isIgnored('/r/docs/a.md', [], ['/r'])).toBeFalsy()
  })

  // The pre-existing contract (before issue #102): a pattern that IS the
  // absolute path, or is `**`-prefixed so it can absorb one, already
  // matched — every FILE-level `ignore` call site (`CheckLinks.ts`,
  // `CheckRefs.ts`, `CheckProseRefs.ts`, `CheckCoverage.ts`,
  // `SummaryTree.ts`) used to call `matchesAny(f, ignore)` directly against
  // this absolute form, so it must keep working unchanged.
  it('matches a `**`-prefixed pattern against the absolute path', () => {
    expect(isIgnored('/r/docs/SKIP.md', ['**/SKIP.md'], ['/r'])).toBeTruthy()
  })

  // Issue #102, file-level case: the same bug reported for DIRECTORY
  // pruning also broke every downstream FILE-level `ignore` filter — a
  // root-relative pattern with no leading `**` segment (the form anyone
  // writes, e.g. `docs/SKIP.md`) could never match an absolute path.
  it('matches a root-relative pattern with no leading ** segment, against the containing root', () => {
    expect(isIgnored('/r/docs/SKIP.md', ['docs/SKIP.md'], ['/r'])).toBeTruthy()
  })

  it('picks whichever of several roots actually contains the candidate', () => {
    expect(isIgnored('/b/private/x.md', ['private/x.md'], ['/a', '/b'])).toBeTruthy()
    expect(isIgnored('/a/private/x.md', ['private/x.md'], ['/a', '/b'])).toBeTruthy()
  })

  it('is false for a file that matches none of the patterns, absolute or relative', () => {
    expect(isIgnored('/r/docs/kept.md', ['docs/SKIP.md'], ['/r'])).toBeFalsy()
  })
})
