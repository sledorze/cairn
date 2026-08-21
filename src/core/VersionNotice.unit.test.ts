import { describe, expect, it } from 'vitest'

import { parseVersionRecord, serializeVersionRecord, versionNoticeFor } from './VersionNotice.ts'

describe('versionNoticeFor()', () => {
  it('is null (no notice) when nothing was ever recorded — a first-ever stamp, not an upgrade', () => {
    expect(versionNoticeFor(null, '0.13.2')).toBeNull()
  })

  it('is null (no notice) when the recorded version matches the running version — nothing changed', () => {
    expect(versionNoticeFor('0.13.2', '0.13.2')).toBeNull()
  })

  it('names both versions when they genuinely differ — the actionable case', () => {
    expect(versionNoticeFor('0.9.0', '0.10.0')).toBe('cairn 0.9.0 → 0.10.0')
  })

  // A downgrade (running an older cairn than what last stamped this repo) is
  // just as real a mismatch as an upgrade — e.g. a CI matrix job pinned to
  // an older version, or a local rollback. The notice's job is "something
  // changed since this repo was last stamped," not "you moved forward."
  it('also fires on a downgrade — same mismatch, not upgrade-only', () => {
    expect(versionNoticeFor('0.13.2', '0.11.0')).toBe('cairn 0.13.2 → 0.11.0')
  })
})

describe('serializeVersionRecord() / parseVersionRecord() round-trip', () => {
  it('round-trips a real record', () => {
    const record = { version: '0.13.2' }
    expect(parseVersionRecord(serializeVersionRecord(record))).toEqual(record)
  })

  it('serializes with a trailing newline — clean git diff, matching every other sidecar', () => {
    expect(serializeVersionRecord({ version: '0.13.2' })).toMatch(/\n$/)
  })

  it('parses null (not a throw) for malformed JSON — a corrupt sidecar reads as absent', () => {
    expect(parseVersionRecord('{not json')).toBeNull()
  })

  it('parses null for well-formed JSON that does not match the schema', () => {
    expect(parseVersionRecord(JSON.stringify({ version: 42 }))).toBeNull()
  })

  it('parses null for an empty object — missing the required version field', () => {
    expect(parseVersionRecord(JSON.stringify({}))).toBeNull()
  })
})
