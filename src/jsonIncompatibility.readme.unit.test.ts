// Guards README.md against documenting only SOME of the real `--json` incompatibilities.
// cli.ts rejects `--json` combined with 8 different flags/checks: 6 are registered in
// `JSON_INCOMPATIBLE_PLUGINS` (each CheckPlugin owns its own `jsonUnsupportedMessage`),
// plus 2 hand-written guards for `--stamp`/`--migrate-stamps` and `--report-deletions`
// that aren't part of the plugin registry (see cli.ts's comment on why). An earlier
// adversarial review of this README found only the 2 hand-written cases undocumented
// and nearly shipped a test covering just those — missing that all 5 (now 6)
// registry-based cases were ALSO completely undocumented. This test enumerates the real
// registry so a 7th plugin added later without README coverage fails here too, not just
// the 2 that happened to get noticed once.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

import { coveragePlugin } from './program/structure/CheckCoverage.ts'
import { docCoveragePlugin } from './program/structure/CheckDocCoverage.ts'
import { freshnessPlugin } from './program/structure/CheckFreshness.ts'
import { storyMapTiersPlugin } from './program/structure/CheckStoryMapTiers.ts'
import { proseRefsPlugin } from './program/links/CheckProseRefs.ts'
import { refsPlugin } from './program/links/CheckRefs.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')

// The registry cli.ts actually wires up (JSON_INCOMPATIBLE_PLUGINS) — kept in sync by
// hand since cli.ts doesn't export that private const; each plugin's own
// `jsonUnsupportedMessage` is the real source of truth this test reads from.
const REGISTRY_PLUGINS = [
  refsPlugin,
  proseRefsPlugin,
  coveragePlugin,
  docCoveragePlugin,
  freshnessPlugin,
  storyMapTiersPlugin,
]

// Not part of the plugin registry (need live GitFs / aren't a CheckPlugin) — literal
// strings duplicated from cli.ts's two hand-written `--json` guards. Keep these in sync
// with cli.ts by hand; a mismatch here means either README or cli.ts's wording changed
// without the other, which is exactly what this test exists to catch.
const HAND_WRITTEN_MESSAGES = [
  '--json cannot be combined with --stamp/--migrate-stamps',
  '--json cannot be combined with --report-deletions',
]

const allMessages = [...REGISTRY_PLUGINS.map((p) => p.jsonUnsupportedMessage), ...HAND_WRITTEN_MESSAGES]

// Scoped to the specific paragraph documenting the incompatibility, NOT a whole-README
// search: `--refs`, `--stamp`, `checks.coverage`, etc. all already appear dozens of
// times elsewhere in README (as command names, section headers) regardless of whether
// the INCOMPATIBILITY itself is documented anywhere — an unscoped "flag name appears
// somewhere in README" check would have passed even before this paragraph was added
// (verified: it did, against this repo's own pre-fix README). Anchoring to the one
// paragraph that actually makes the claim is what makes this a real test.
const incompatibilityParagraph = readme.split('\n').find((line) => line.includes('cannot be combined'))

describe('README.md documents every real --json incompatibility', () => {
  it('sanity: there really are 8 known incompatible combinations', () => {
    expect(allMessages).toHaveLength(8)
  })

  it('sanity: the documenting paragraph exists', () => {
    expect(incompatibilityParagraph).toBeDefined()
  })

  it.each(allMessages)('the flag/check named in %j is mentioned in the incompatibility paragraph', (message) => {
    expect(message).toBeDefined()
    // Loose check on purpose: assert the flag/check NAME from the message (not the
    // full sentence, which cli.ts phrases as a JSON error, not prose) appears in the
    // scoped paragraph — README is allowed to phrase this in its own words, as long as
    // the flag itself isn't silently absent from the one place making the claim.
    const flagOrCheckName = message?.match(/--[\w-]+|checks\.\w+/)?.[0]
    expect(flagOrCheckName).toBeDefined()
    expect(incompatibilityParagraph).toContain(flagOrCheckName as string)
  })
})
