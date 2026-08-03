// `cairn init` — scaffold agent guidance from a single source of truth.
// The SAME convention body is rendered into the format each agent reads:
//  - Claude Code:   .claude/rules/docs-summaries.md          (frontmatter `paths:`)
//  - GitHub Copilot: .github/instructions/docs-summaries.instructions.md (`applyTo:`)
//  - Cross-tool:    a marked block in AGENTS.md — the file OpenCode (and Codex) read
//    natively, so `--agent opencode` is a thin alias for `--agent agents`: no separate
//    file format, just this block.
//  - Claude/Codex:  .claude/skills/cairn/SKILL.md            (the writing methodology)
//  - Claude Code:   a marked `@AGENTS.md` import in CLAUDE.md — Claude Code auto-loads
//    CLAUDE.md at session start but never reads AGENTS.md on its own, so without this
//    pointer the cross-tool block in AGENTS.md is invisible to it.
// Plus a starter .cairnrc.json (only when absent).
//
// Effect-based (`FileSystem` service), matching `io/DocsFs.ts`/`config.ts`'s own
// convention — disk IO is the only reason this isn't pure. `path` stays on
// `node:path` directly (deterministic string manipulation, no IO).

import * as path from 'node:path'

import { Effect, FileSystem } from 'effect'

import { CONVENTION_BODY, SKILL_BODY } from './content.ts'

// Single source of truth for valid `--agent` values, so the CLI's choice list
// (src/cli.ts) can never drift from what `runInit` actually understands.
export const AGENT_TARGETS = ['agents', 'all', 'claude', 'copilot', 'opencode'] as const
export type AgentTarget = (typeof AGENT_TARGETS)[number]

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

/** Strips trailing `/` characters without a regex — `r.replace(/\/+$/, '')`
 * previously did this, but CodeQL flags an unanchored trailing `+$` as a
 * polynomial-time ReDoS shape on attacker-controlled input; `roots` values
 * ultimately come from a project's own `.cairnrc.json`, not untrusted input,
 * but a plain loop is just as clear and closes the finding for good. */
const stripTrailingSlashes = (s: string): string => {
  let end = s.length
  while (end > 0 && s[end - 1] === '/') {
    end--
  }
  return s.slice(0, end)
}

const rootsToGlobs = (roots: readonly string[]): string[] => roots.map((r) => `${stripTrailingSlashes(r)}/**`)

const write = (file: string, content: string, written: string[]): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(file), { recursive: true })
    yield* fs.writeFileString(file, content.endsWith('\n') ? content : `${content}\n`)
    written.push(file)
  })

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

/**
 * Insert `block` between the `AGENTS_START`/`AGENTS_END` markers if they're
 * already present in `existing` (replacing whatever they currently wrap),
 * else append `block` as a new section — never touching the rest of
 * `existing`'s content either way.
 *
 * Extracted (issue #106 DRY audit) after this exact insert-or-replace
 * shape turned up hand-duplicated between `upsertAgentsBlock` and
 * `upsertClaudeMdImport` below — each still owns its own existence check,
 * seed text for a brand-new file, and (for CLAUDE.md) the extra
 * already-imported short-circuit, since those genuinely differ per file.
 */
const upsertMarkedBlock = (existing: string, block: string): string =>
  existing.includes(AGENTS_START) && existing.includes(AGENTS_END)
    ? existing.replace(new RegExp(`${AGENTS_START}[\\s\\S]*?${AGENTS_END}`), block)
    : `${existing.trimEnd()}\n\n${block}\n`

/** Insert or replace the cairn block in AGENTS.md, leaving other content intact. */
const upsertAgentsBlock = (cwd: string, written: string[]): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = path.join(cwd, 'AGENTS.md')
    const block = `${AGENTS_START}\n\n${CONVENTION_BODY.trimEnd()}\n\n${AGENTS_END}`
    let next: string
    if (yield* fs.exists(file)) {
      next = upsertMarkedBlock(yield* fs.readFileString(file), block)
    } else {
      next = `# AGENTS.md\n\n${block}\n`
    }
    yield* fs.writeFileString(file, next.endsWith('\n') ? next : `${next}\n`)
    written.push(file)
  })

/** Ensure CLAUDE.md imports AGENTS.md. Claude Code auto-loads CLAUDE.md (not AGENTS.md)
 * at session start, so without this the AGENTS.md block cairn writes is never read. Leaves
 * other CLAUDE.md content intact, and no-ops if an `@AGENTS.md` import is already present
 * (hand-written or from a previous run). */
const upsertClaudeMdImport = (
  cwd: string,
  written: string[],
  skipped: string[],
): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = path.join(cwd, 'CLAUDE.md')
    const block = `${AGENTS_START}\n@AGENTS.md\n${AGENTS_END}`
    if (yield* fs.exists(file)) {
      const existing = yield* fs.readFileString(file)
      if (existing.includes('@AGENTS.md')) {
        skipped.push(file)
        return
      }
      const next = upsertMarkedBlock(existing, block)
      yield* fs.writeFileString(file, next.endsWith('\n') ? next : `${next}\n`)
    } else {
      yield* fs.writeFileString(file, `${block}\n`)
    }
    written.push(file)
  })

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
export const runInit = ({ agent, cwd, roots }: InitArgs): Effect.Effect<InitResult, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const globs = rootsToGlobs(roots)
    const written: string[] = []
    const skipped: string[] = []

    const doClaude = agent === 'claude' || agent === 'all'
    const doCopilot = agent === 'copilot' || agent === 'all'
    const doAgents = agent === 'agents' || agent === 'opencode' || agent === 'all'

    if (doClaude) {
      yield* write(path.join(cwd, '.claude/rules/docs-summaries.md'), claudeRule(globs), written)
      yield* write(path.join(cwd, '.claude/skills/cairn/SKILL.md'), skillFile(), written)
      yield* upsertClaudeMdImport(cwd, written, skipped)
    }
    if (doCopilot) {
      yield* write(
        path.join(cwd, '.github/instructions/docs-summaries.instructions.md'),
        copilotInstructions(globs),
        written,
      )
    }
    if (doAgents || doClaude || doCopilot) {
      yield* upsertAgentsBlock(cwd, written)
    }

    const rc = path.join(cwd, '.cairnrc.json')
    if (yield* fs.exists(rc)) {
      skipped.push(rc)
    } else {
      yield* write(rc, starterConfig(roots), written)
    }

    return { skipped, written }
  })
