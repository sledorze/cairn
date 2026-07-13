import { describe, expect, it } from 'vitest'

import {
  classifySummary,
  countLines,
  extractSourceHash,
  hashContent,
  isSummaryFile,
  needsSummary,
  sourceHashTag,
  summaryPathFor,
  withSourceHash,
} from './DocSummaries.ts'

describe('isSummaryFile()', () => {
  it('recognises generated summary files', () => {
    expect(isSummaryFile('docs/a/foo.summary.md')).toBeTruthy()
    expect(isSummaryFile('docs/a/foo.md')).toBeFalsy()
  })
})

describe('summaryPathFor()', () => {
  it('derives the sibling summary path', () => {
    expect(summaryPathFor('docs/a/foo.md')).toBe('docs/a/foo.summary.md')
  })
})

describe('countLines()', () => {
  it('counts lines and ignores a single trailing newline', () => {
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\nb\nc\n')).toBe(3)
    expect(countLines('')).toBe(0)
    expect(countLines('one')).toBe(1)
  })
})

describe('needsSummary()', () => {
  it('flags a long non-summary markdown file', () => {
    expect(needsSummary({ lineCount: 31, path: 'docs/a/big.md', thresholdLines: 30 })).toBeTruthy()
  })

  it('ignores short files (at or below the threshold)', () => {
    expect(needsSummary({ lineCount: 30, path: 'docs/a/small.md', thresholdLines: 30 })).toBeFalsy()
  })

  it('never requires a summary of a summary', () => {
    expect(needsSummary({ lineCount: 999, path: 'docs/a/big.summary.md', thresholdLines: 30 })).toBeFalsy()
  })

  it('ignores non-markdown files', () => {
    expect(needsSummary({ lineCount: 999, path: 'docs/a/data.json', thresholdLines: 30 })).toBeFalsy()
  })
})

describe('hashContent()', () => {
  it('is deterministic and content-sensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'))
    expect(hashContent('abc')).not.toBe(hashContent('abd'))
    expect(hashContent('abc')).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('extractSourceHash()', () => {
  it('reads back the stamped hash', () => {
    const hash = hashContent('# source')
    const summary = `${sourceHashTag(hash)}\n\n# résumé`
    expect(extractSourceHash(summary)).toBe(hash)
  })

  it('returns null when no stamp is present', () => {
    expect(extractSourceHash('# résumé sans tampon')).toBeNull()
  })
})

describe('withSourceHash()', () => {
  it('prepends a stamp when none exists and is readable back', () => {
    const out = withSourceHash('# résumé', 'a'.repeat(64))
    expect(extractSourceHash(out)).toBe('a'.repeat(64))
    expect(out.endsWith('# résumé')).toBeTruthy()
  })

  it('replaces an existing stamp in place', () => {
    const first = withSourceHash('# r', 'a'.repeat(64))
    const second = withSourceHash(first, 'b'.repeat(64))
    expect(extractSourceHash(second)).toBe('b'.repeat(64))
    expect(second.split('source-sha256').length - 1).toBe(1)
  })
})

describe('classifySummary()', () => {
  it('returns missing when the summary does not exist', () => {
    expect(classifySummary({ recordedHash: null, sourceHash: 'a', summaryExists: false })).toBe('missing')
  })

  it('returns stale when the stamp is absent', () => {
    expect(classifySummary({ recordedHash: null, sourceHash: 'a', summaryExists: true })).toBe('stale')
  })

  it('returns stale when the stamped hash no longer matches the source', () => {
    expect(classifySummary({ recordedHash: 'old', sourceHash: 'new', summaryExists: true })).toBe('stale')
  })

  it('returns ok when the stamped hash matches the source', () => {
    expect(classifySummary({ recordedHash: 'same', sourceHash: 'same', summaryExists: true })).toBe('ok')
  })
})
