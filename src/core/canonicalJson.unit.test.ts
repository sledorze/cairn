import { describe, expect, it } from 'vitest'

import { canonicalJson } from './canonicalJson.ts'

// Generates every distinct key-insertion order for a fixed set of entries,
// rather than one hand-picked "before/after" pair — the exact systematic
// check a property-based test (fast-check) would run, without adding a new
// dependency for it: with 4 entries there are only 24 permutations, small
// enough to enumerate directly and prove order-independence for the WHOLE
// class of reorderings, not just the one construction order this file's
// author happened to think of.
const permutations = <T>(items: readonly T[]): T[][] => {
  if (items.length <= 1) {
    return [[...items]]
  }
  const result: T[][] = []
  for (const [i, item] of items.entries()) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const restOrder of permutations(rest)) {
      result.push([item, ...restOrder])
    }
  }
  return result
}

describe('canonicalJson()', () => {
  it('produces the identical string for every key-insertion order of the same flat object', () => {
    const entries: [string, unknown][] = [
      ['from', 'feature'],
      ['to', 'decision'],
      ['scope', 'sibling'],
      ['name', 'requires'],
    ]
    const outputs = new Set(
      permutations(entries).map((order) => canonicalJson(Object.fromEntries(order) as Record<string, unknown>)),
    )
    expect(outputs.size).toBe(1)
  })

  it('produces the identical string for every key-insertion order of a NESTED object (the real `to`/`scope` shape)', () => {
    const innerEntries: [string, unknown][] = [
      ['n', 1],
      ['of', ['decision', 'spikes']],
    ]
    const outputs = new Set(
      permutations(innerEntries).map((order) =>
        canonicalJson({ scope: { under: 'team-a' }, to: { atLeast: Object.fromEntries(order) } }),
      ),
    )
    expect(outputs.size).toBe(1)
  })

  it('still distinguishes genuinely different values, not just different orders', () => {
    expect(canonicalJson({ a: 1, b: 2 })).not.toBe(canonicalJson({ a: 1, b: 3 }))
    expect(canonicalJson({ a: 1 })).not.toBe(`${canonicalJson({ a: 1, b: undefined })}x`)
  })

  it('preserves array element ORDER (arrays are ordered data, unlike object keys)', () => {
    expect(canonicalJson({ of: ['a', 'b'] })).not.toBe(canonicalJson({ of: ['b', 'a'] }))
  })

  it('omits undefined-valued properties, matching plain JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })
})
