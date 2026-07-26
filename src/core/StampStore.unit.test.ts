import { describe, expect, it } from 'vitest'

import {
  isSidecarPath,
  metaRootFor,
  nodePathForSidecar,
  parseStamp,
  serializeStamp,
  sidecarPathFor,
  STAMP_VERSION,
} from './StampStore.ts'
import type { MetaLayout } from './StampStore.ts'

const layout: MetaLayout = { base: '/r', metaRoot: metaRootFor('/r') }

describe('metaRootFor()', () => {
  it('joins base with the hidden .cairn directory', () => {
    expect(metaRootFor('/r')).toBe('/r/.cairn')
  })
})

describe('sidecarPathFor() / nodePathForSidecar() round-trip', () => {
  it('mirrors a single-root node path 1:1 under the hidden tree', () => {
    const nodeAtPath = '/r/docs/a.summary.md'
    const sidecar = sidecarPathFor(nodeAtPath, layout)
    expect(sidecar).toBe('/r/.cairn/docs/a.summary.md.json')
    expect(nodePathForSidecar(sidecar, layout)).toBe(nodeAtPath)
  })

  it('mirrors a directory summary node path', () => {
    const nodeAtPath = '/r/docs/guide/_SUMMARY.md'
    const sidecar = sidecarPathFor(nodeAtPath, layout)
    expect(sidecar).toBe('/r/.cairn/docs/guide/_SUMMARY.md.json')
    expect(nodePathForSidecar(sidecar, layout)).toBe(nodeAtPath)
  })

  it('partitions two distinct doc roots without collision (S5, multi-root)', () => {
    const a = sidecarPathFor('/r/docs/a.summary.md', layout)
    const b = sidecarPathFor('/r/packages/x/docs/a.summary.md', layout)
    expect(a).not.toBe(b)
    expect(a).toBe('/r/.cairn/docs/a.summary.md.json')
    expect(b).toBe('/r/.cairn/packages/x/docs/a.summary.md.json')
    expect(nodePathForSidecar(a, layout)).toBe('/r/docs/a.summary.md')
    expect(nodePathForSidecar(b, layout)).toBe('/r/packages/x/docs/a.summary.md')
  })

  it('throws when the node path is not under base (R7 invariant)', () => {
    expect(() => sidecarPathFor('/elsewhere/a.summary.md', layout)).toThrow(/not under base/)
  })
})

describe('nodePathForSidecar() on malformed/foreign input', () => {
  it('returns null for a path outside metaRoot', () => {
    expect(nodePathForSidecar('/r/docs/a.summary.md.json', layout)).toBeNull()
  })

  it('returns null for a non-.json file dropped into .cairn/ by hand', () => {
    expect(nodePathForSidecar('/r/.cairn/docs/notes.txt', layout)).toBeNull()
  })
})

describe('isSidecarPath()', () => {
  it('is true for the meta root itself and anything under it', () => {
    expect(isSidecarPath('/r/.cairn', layout.metaRoot)).toBeTruthy()
    expect(isSidecarPath('/r/.cairn/docs/a.summary.md.json', layout.metaRoot)).toBeTruthy()
  })

  it('is false for a sibling path that merely shares a prefix', () => {
    expect(isSidecarPath('/r/.cairn-old/x', layout.metaRoot)).toBeFalsy()
    expect(isSidecarPath('/r/docs/a.md', layout.metaRoot)).toBeFalsy()
  })
})

describe('serializeStamp() / parseStamp() round-trip', () => {
  it('reads back exactly what was serialised', () => {
    const record = { sha256: 'a'.repeat(64), version: STAMP_VERSION }
    expect(parseStamp(serializeStamp(record))).toEqual(record)
  })

  it('returns null for malformed JSON (corrupt/merge-conflicted sidecar, R5)', () => {
    expect(parseStamp('<<<<<<< HEAD\n{"sha256":"a"}\n=======\n')).toBeNull()
    expect(parseStamp('')).toBeNull()
    expect(parseStamp('not json at all')).toBeNull()
  })

  it('returns null for well-formed JSON that does not match the shape', () => {
    expect(parseStamp('{"sha256": 42}')).toBeNull() // wrong type
    expect(parseStamp('{"version": 1}')).toBeNull() // missing sha256
    expect(parseStamp('[]')).toBeNull()
    expect(parseStamp('"just a string"')).toBeNull()
  })

  it('tolerates unknown extra keys — forward compatibility for a richer future sidecar (R4)', () => {
    const sha256 = 'b'.repeat(64)
    const withExtra = `{"sha256":"${sha256}","version":1,"futureField":{"nested":true}}`
    expect(parseStamp(withExtra)).toEqual({ sha256, version: 1 })
  })
})
