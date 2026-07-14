import { describe, expect, it } from 'vitest'

import { parseRcJson } from './config.ts'

describe('parseRcJson()', () => {
  it('parses valid JSON', () => {
    expect(parseRcJson('{"roots":["docs"]}', 'x.json')).toEqual({ roots: ['docs'] })
  })

  it('throws a clear, file-scoped message on malformed JSON', () => {
    expect(() => parseRcJson('{ not json', '/repo/.cairnrc.json')).toThrow(/invalid JSON in \/repo\/\.cairnrc\.json/)
  })
})
