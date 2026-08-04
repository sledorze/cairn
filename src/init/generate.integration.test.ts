import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import type { Effect, FileSystem } from 'effect'
import { Effect as Eff, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decodeConfig } from '../core/Config.ts'
import { runInit } from './generate.ts'

// Exercises real-filesystem scaffolding writes. `generate.ts` is Effect-based
// (`FileSystem` service, matching `io/DocsFs.ts`'s own convention), so every
// call here runs through the real Node binding.
const run = <A>(eff: Effect.Effect<A, unknown, FileSystem.FileSystem>): Promise<A> =>
  Eff.runPromise(eff.pipe(Eff.provide(NodeServices.layer)))

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

  it('creates CLAUDE.md importing AGENTS.md when absent', async () => {
    await run(runInit({ agent: 'claude', cwd, roots: ['docs'] }))
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('@AGENTS.md')
  })

  it('appends the import to an existing CLAUDE.md without touching prior content', async () => {
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Project notes\n\nSome hand-written guidance.\n')
    await run(runInit({ agent: 'claude', cwd, roots: ['docs'] }))
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('Some hand-written guidance.')
    expect(claudeMd).toContain('@AGENTS.md')
  })

  it('is idempotent: re-running does not duplicate the import block', async () => {
    await run(runInit({ agent: 'claude', cwd, roots: ['docs'] }))
    await run(runInit({ agent: 'claude', cwd, roots: ['docs'] }))
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')
    expect(claudeMd.match(/@AGENTS\.md/g)).toHaveLength(1)
  })

  it('leaves a hand-written `@AGENTS.md` import untouched and reports it as skipped', async () => {
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '@AGENTS.md\n')
    const result = await run(runInit({ agent: 'claude', cwd, roots: ['docs'] }))
    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n')
    expect(result.skipped).toContain(path.join(cwd, 'CLAUDE.md'))
  })

  it('does not write CLAUDE.md for --agent copilot or --agent agents', async () => {
    await run(runInit({ agent: 'copilot', cwd, roots: ['docs'] }))
    expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBeFalsy()
  })

  // A `roots` entry with a trailing slash (e.g. copy-pasted from a shell
  // completion, or just a habit) must not produce a doubled `//**` glob —
  // `stripTrailingSlashes` exists specifically to normalise this before the
  // `/**` suffix is appended.
  it('strips a trailing slash from a root before appending the glob suffix', async () => {
    await run(runInit({ agent: 'claude', cwd, roots: ['docs/'] }))
    const rule = fs.readFileSync(path.join(cwd, '.claude/rules/docs-summaries.md'), 'utf8')
    expect(rule).toContain("'docs/**'")
    expect(rule).not.toContain('docs//**')
  })

  // Separate skill from the summary-writing one — different trigger ("this needs a
  // real design"), different content, own file, per generate.ts's own header comment.
  it('writes a separate cairn-design-package skill file, distinct from the summary skill', async () => {
    await run(runInit({ agent: 'claude', cwd, roots: ['docs'] }))
    const designSkill = fs.readFileSync(path.join(cwd, '.claude/skills/cairn-design-package/SKILL.md'), 'utf8')
    expect(designSkill).toContain('name: cairn-design-package')
    expect(designSkill).toContain('checks.coverage')
    expect(designSkill).toContain('capturable')
    const summarySkill = fs.readFileSync(path.join(cwd, '.claude/skills/cairn/SKILL.md'), 'utf8')
    expect(summarySkill).not.toContain('cairn-design-package')
  })
})

// OpenCode reads AGENTS.md natively (falling back from CLAUDE.md), so `--agent opencode`
// is a thin alias for `--agent agents`: same AGENTS.md block, no separate file format,
// and (unlike --agent claude) no CLAUDE.md import.
describe('runInit(--agent opencode)', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-init-opencode-'))
  })

  afterEach(() => {
    fs.rmSync(cwd, { force: true, recursive: true })
  })

  it('writes the AGENTS.md block', async () => {
    await run(runInit({ agent: 'opencode', cwd, roots: ['docs'] }))
    const agentsMd = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('<!-- cairn:start -->')
  })

  it('does not write CLAUDE.md, Claude rules, Claude skills, or Copilot instructions', async () => {
    await run(runInit({ agent: 'opencode', cwd, roots: ['docs'] }))
    expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBeFalsy()
    expect(fs.existsSync(path.join(cwd, '.claude/rules/docs-summaries.md'))).toBeFalsy()
    expect(fs.existsSync(path.join(cwd, '.claude/skills/cairn-design-package/SKILL.md'))).toBeFalsy()
    expect(fs.existsSync(path.join(cwd, '.github/instructions/docs-summaries.instructions.md'))).toBeFalsy()
  })

  // DX finding: the scaffolded agent guidance — the ONE place an agent
  // working in a fresh repo learns cairn exists at all — only ever
  // documented the summaries+links baseline. An agent bootstrapped via
  // `cairn init` had zero way to discover `checks.coverage` (this tool's
  // own flagship feature for "organize product knowledge," per the
  // README's own lead) or `--refs`/`--prose-refs` short of separately
  // reading the npm README — not something a repo-scoped agent naturally
  // does. Every opt-in check must at least be NAMED so an agent knows to
  // investigate further when relevant, even if the full mechanical
  // workflow for each stays in the README, not this lean rule file.
  it('mentions every opt-in check by name, not just the summaries+links baseline', async () => {
    await run(runInit({ agent: 'opencode', cwd, roots: ['docs'] }))
    const agentsMd = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('checks.coverage')
    expect(agentsMd).toContain('--refs')
    expect(agentsMd).toContain('--prose-refs')
  })
})

// The starter `.cairnrc.json` scaffolds a `$schema` pointer so adopters get editor
// autocomplete/validation from day one (see the shipped schema/cairn.schema.json). Pinned
// by decoding it through the real config decoder — if the scaffold ever drifts out of
// sync with CairnConfigSchema, this fails loudly instead of shipping a broken example.
describe('runInit() — starter .cairnrc.json', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-init-rc-'))
  })

  afterEach(() => {
    fs.rmSync(cwd, { force: true, recursive: true })
  })

  it('scaffolds a $schema pointer into node_modules, and the result decodes cleanly', async () => {
    await run(runInit({ agent: 'all', cwd, roots: ['docs'] }))
    const rc = fs.readFileSync(path.join(cwd, '.cairnrc.json'), 'utf8')
    const parsed: unknown = JSON.parse(rc)
    expect(parsed).toMatchObject({ $schema: './node_modules/@sledorze/cairn/schema/cairn.schema.json' })
    expect(Result.isSuccess(decodeConfig(parsed))).toBeTruthy()
  })

  it('leaves an existing .cairnrc.json untouched and reports it as skipped', async () => {
    fs.writeFileSync(path.join(cwd, '.cairnrc.json'), '{}\n')
    const result = await run(runInit({ agent: 'all', cwd, roots: ['docs'] }))
    expect(fs.readFileSync(path.join(cwd, '.cairnrc.json'), 'utf8')).toBe('{}\n')
    expect(result.skipped).toContain(path.join(cwd, '.cairnrc.json'))
  })
})
