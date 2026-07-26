import { describe, expect, it } from 'vitest'

import { parseRefs, serializeRefs } from './RefStore.ts'

describe('serializeRefs() / parseRefs()', () => {
  it('round-trips a record with references', () => {
    const record = { refs: [{ hash: 'abc123', target: '../src/x.ts' }] }
    expect(parseRefs(serializeRefs(record))).toEqual(record)
  })

  it('round-trips an anchor-qualified reference', () => {
    const record = { refs: [{ anchor: 'getting-started', hash: 'abc123', target: './guide.md' }] }
    expect(parseRefs(serializeRefs(record))).toEqual(record)
  })

  it('round-trips an empty refs list', () => {
    const record = { refs: [] }
    expect(parseRefs(serializeRefs(record))).toEqual(record)
  })

  it('serializes with a trailing newline for a clean git diff', () => {
    expect(serializeRefs({ refs: [] }).endsWith('\n')).toBeTruthy()
  })

  it('returns null for invalid JSON rather than throwing', () => {
    expect(parseRefs('not json {')).toBeNull()
  })

  it('returns null for well-formed JSON that does not match the schema', () => {
    expect(parseRefs('{"refs": "not-an-array"}')).toBeNull()
    expect(parseRefs('{"nope": true}')).toBeNull()
  })

  it('tolerates unknown keys (forward compatibility, matching StampStore.ts)', () => {
    const parsed = parseRefs('{"refs": [{"target": "x.ts", "hash": "h"}], "future": "field"}')
    expect(parsed).toEqual({ refs: [{ hash: 'h', target: 'x.ts' }] })
  })
})
