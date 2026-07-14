// `cairn init` — scaffold agent guidance from a single source of truth.
// The SAME convention body is rendered into the format each agent reads:
//  - Claude Code:   .claude/rules/docs-summaries.md          (frontmatter `paths:`)
//  - GitHub Copilot: .github/instructions/docs-summaries.instructions.md (`applyTo:`)
//  - Cross-tool:    a marked block in AGENTS.md
//  - Claude/Codex:  .claude/skills/cairn/SKILL.md            (the writing methodology)
//  - Claude Code:   a marked `@AGENTS.md` import in CLAUDE.md — Claude Code auto-loads
//    CLAUDE.md at session start but never reads AGENTS.md on its own, so without this
//    pointer the cross-tool block in AGENTS.md is invisible to it.
// Plus a starter .cairnrc.json (only when absent).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { CONVENTION_BODY, SKILL_BODY } from './content.ts'

export type AgentTarget = 'agents' | 'all' | 'claude' | 'copilot'

export interface InitArgs {
  readonly agent: AgentTarget
  readonly cwd: string
  readonly roots: readonly string[]
}

export interface InitResult {
  readonly written: readonly string[]
  readonly skipped: readonly string[]
}

const AGENTS_START = '<!-- cairn:start -->'
const AGENTS_END = '<!-- cairn:end -->'

const rootsToGlobs = (roots: readonly string[]): string[] => roots.map((r) => `${r.replace(/\/+$/, '')}/**`)

const ensureDir = (file: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

const write = (file: string, content: string, written: string[]): void => {
  ensureDir(file)
  fs.writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`)
  written.push(file)
}

const claudeRule = (globs: readonly string[]): string => {
  const paths = globs.map((g) => `  - '${g}'`).join('\n')
  return `---\npaths:\n${paths}\n---\n\n${CONVENTION_BODY}`
}

const copilotInstructions = (globs: readonly string[]): string =>
  `---\napplyTo: '${globs.join(', ')}'\n---\n\n${CONVENTION_BODY}`

const skillFile = (): string =>
  [
    '---',
    'name: cairn',
    'description: Methodology for writing and maintaining the hierarchical documentation summary tree enforced by cairn. Use when authoring or refreshing docs summaries (X.summary.md / _SUMMARY.md).',
    '---',
    '',
    SKILL_BODY,
  ].join('\n')

/** Insert or replace the cairn block in AGENTS.md, leaving other content intact. */
const upsertAgentsBlock = (cwd: string, written: string[]): void => {
  const file = path.join(cwd, 'AGENTS.md')
  const block = `${AGENTS_START}\n\n${CONVENTION_BODY.trimEnd()}\n\n${AGENTS_END}`
  let next: string
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8')
    if (existing.includes(AGENTS_START) && existing.includes(AGENTS_END)) {
      next = existing.replace(new RegExp(`${AGENTS_START}[\\s\\S]*?${AGENTS_END}`), block)
    } else {
      next = `${existing.trimEnd()}\n\n${block}\n`
    }
  } else {
    next = `# AGENTS.md\n\n${block}\n`
  }
  fs.writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`)
  written.push(file)
}

/** Ensure CLAUDE.md imports AGENTS.md. Claude Code auto-loads CLAUDE.md (not AGENTS.md)
 * at session start, so without this the AGENTS.md block cairn writes is never read. Leaves
 * other CLAUDE.md content intact, and no-ops if an `@AGENTS.md` import is already present
 * (hand-written or from a previous run). */
const upsertClaudeMdImport = (cwd: string, written: string[], skipped: string[]): void => {
  const file = path.join(cwd, 'CLAUDE.md')
  const block = `${AGENTS_START}\n@AGENTS.md\n${AGENTS_END}`
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8')
    if (existing.includes('@AGENTS.md')) {
      skipped.push(file)
      return
    }
    const next =
      existing.includes(AGENTS_START) && existing.includes(AGENTS_END)
        ? existing.replace(new RegExp(`${AGENTS_START}[\\s\\S]*?${AGENTS_END}`), block)
        : `${existing.trimEnd()}\n\n${block}\n`
    fs.writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`)
  } else {
    fs.writeFileSync(file, `${block}\n`)
  }
  written.push(file)
}

const starterConfig = (roots: readonly string[]): string =>
  `${JSON.stringify(
    {
      $schema: './node_modules/@sledorze/cairn/schema/cairn.schema.json',
      ignore: ['**/node_modules/**'],
      naming: { dirSummary: '_SUMMARY.md', fileSummarySuffix: '.summary.md' },
      roots,
      thresholdLines: 30,
    },
    null,
    2,
  )}\n`

/** Run the scaffold. Returns which files were written vs left untouched. */
export const runInit = ({ agent, cwd, roots }: InitArgs): InitResult => {
  const globs = rootsToGlobs(roots)
  const written: string[] = []
  const skipped: string[] = []

  const doClaude = agent === 'claude' || agent === 'all'
  const doCopilot = agent === 'copilot' || agent === 'all'
  const doAgents = agent === 'agents' || agent === 'all'

  if (doClaude) {
    write(path.join(cwd, '.claude/rules/docs-summaries.md'), claudeRule(globs), written)
    write(path.join(cwd, '.claude/skills/cairn/SKILL.md'), skillFile(), written)
    upsertClaudeMdImport(cwd, written, skipped)
  }
  if (doCopilot) {
    write(path.join(cwd, '.github/instructions/docs-summaries.instructions.md'), copilotInstructions(globs), written)
  }
  if (doAgents || doClaude || doCopilot) {
    upsertAgentsBlock(cwd, written)
  }

  const rc = path.join(cwd, '.cairnrc.json')
  if (fs.existsSync(rc)) {
    skipped.push(rc)
  } else {
    write(rc, starterConfig(roots), written)
  }

  return { skipped, written }
}
