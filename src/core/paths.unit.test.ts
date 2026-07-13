import { describe, expect, it } from 'vitest'

import { toPosix } from './paths.ts'

describe('toPosix()', () => {
  it('converts Windows separators to POSIX', () => {
    expect(toPosix('a\\b\\c.md')).toBe('a/b/c.md')
    expect(toPosix('C:\\docs\\x.md')).toBe('C:/docs/x.md')
  })

  it('leaves POSIX paths unchanged', () => {
    expect(toPosix('/r/docs/a.md')).toBe('/r/docs/a.md')
  })
})
