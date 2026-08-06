// Guards README.md's `--agent` documentation against drifting from the real
// AGENT_TARGETS source of truth. Scoped to the two specific locations that
// actually document the flag (the command table row, the "Pass `--agent...`"
// prose sentence) rather than a whole-file substring search: 'all' and 'agents'
// are short, generic tokens that would trivially match unrelated README prose
// even with zero real documentation of the flag, so an unscoped check would
// pass while telling you nothing (this repo's own README was missing 'agents'
// and 'opencode' from both locations at once — the bug this test now catches).

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

import { AGENT_TARGETS } from './generate.ts'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')

const commandTableRow = readme.split('\n').find((line) => line.includes('`cairn init --agent'))

// The prose documentation is a paragraph, not a single line — collect from the line
// starting "Pass `--agent" through the next blank line.
const lines = readme.split('\n')
const proseStart = lines.findIndex((line) => line.startsWith('Pass `--agent'))
const proseSentence =
  proseStart === -1
    ? undefined
    : lines
        .slice(proseStart)
        .slice(
          0,
          lines.slice(proseStart).findIndex((line) => line.trim() === ''),
        )
        .join(' ')

describe("README.md's --agent documentation covers every real AGENT_TARGETS value", () => {
  it('sanity: both known documentation locations exist', () => {
    expect(commandTableRow).toBeDefined()
    expect(proseSentence).toBeDefined()
  })

  it.each(AGENT_TARGETS)('%s appears in the command table row', (target) => {
    expect(commandTableRow).toContain(target)
  })

  it.each(AGENT_TARGETS)('%s appears in the prose sentence', (target) => {
    expect(proseSentence).toContain(target)
  })
})
