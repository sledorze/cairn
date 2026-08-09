// Guards AGENTS.md against a dead link to its own docs/incidents/** —
// AGENTS.md lives at repo root, OUTSIDE cairn's own scanned `roots`
// (`.cairnrc.json`'s `roots: ["docs"]`), so `cairn check`'s own link
// checker never verifies it. Every link in it up to this point was
// verified by hand, once, at write time — an implicit, unenforced
// contract, not an explicit one (AGENTS.md's own rule: "a new restriction
// must be discoverable, not just correct" — see flagReadme.unit.test.ts
// for the same discipline already applied to README.md's own content).
//
// Reuses `extractReferences` (the same extraction `--refs`/`checkRefs`
// itself uses) rather than hand-rolling a link regex a second time.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

import { extractReferences } from './core/links/MarkdownLinks.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const agentsMd = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')

describe('AGENTS.md link integrity (no automated check covers this file otherwise)', () => {
  it('every relative link in AGENTS.md resolves to a real file or directory', () => {
    const refs = extractReferences(agentsMd)
    const broken = refs
      .map((ref) => ({ anchor: ref.anchor, resolved: path.resolve(repoRoot, ref.target), target: ref.target }))
      .filter((ref) => !fs.existsSync(ref.resolved))
    expect(broken).toEqual([])
  })

  // Found real, on first run (RED, per this repo's own RED-before-GREEN
  // convention): confirms the test actually exercises real content, not a
  // vacuous pass because AGENTS.md happens to have zero relative links.
  it('sanity: AGENTS.md actually has real relative links for the above to exercise', () => {
    const refs = extractReferences(agentsMd)
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.some((r) => r.target.startsWith('docs/incidents/'))).toBeTruthy()
  })
})
