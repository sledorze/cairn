import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runInit } from './generate.ts'

// `--agent claude` must leave Claude Code able to actually discover the convention:
// CLAUDE.md is what Claude Code auto-loads at session start (AGENTS.md is not read on
// its own), so the scaffold must upsert an `@AGENTS.md` import into it.
describe('runInit(--agent claude)', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-init-'))
  })

  afterEach(() => {
    fs.rmSync(cwd, { force: true, recursive: true })
  })

  it('creates CLAUDE.md importing AGENTS.md when absent', () => {
    runInit({ agent: 'claude', cwd, roots: ['docs'] })
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('@AGENTS.md')
  })

  it('appends the import to an existing CLAUDE.md without touching prior content', () => {
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Project notes\n\nSome hand-written guidance.\n')
    runInit({ agent: 'claude', cwd, roots: ['docs'] })
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('Some hand-written guidance.')
    expect(claudeMd).toContain('@AGENTS.md')
  })

  it('is idempotent: re-running does not duplicate the import block', () => {
    runInit({ agent: 'claude', cwd, roots: ['docs'] })
    runInit({ agent: 'claude', cwd, roots: ['docs'] })
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')
    expect(claudeMd.match(/@AGENTS\.md/g)).toHaveLength(1)
  })

  it('leaves a hand-written `@AGENTS.md` import untouched and reports it as skipped', () => {
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '@AGENTS.md\n')
    const result = runInit({ agent: 'claude', cwd, roots: ['docs'] })
    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n')
    expect(result.skipped).toContain(path.join(cwd, 'CLAUDE.md'))
  })

  it('does not write CLAUDE.md for --agent copilot or --agent agents', () => {
    runInit({ agent: 'copilot', cwd, roots: ['docs'] })
    expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBeFalsy()
  })
})
