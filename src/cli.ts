#!/usr/bin/env node
// CLI entrypoint for cairn: hierarchical documentation summaries + dead-link
// checking, plus `init` to scaffold agent guidance. Decision logic is unit-tested
// in the sibling modules; this file is the thin Node/Effect bootstrap.
//
//   cairn check [roots...] [--fix] [--stamp] [--links-only|--summaries-only]
//   cairn check --root 'packages/*/docs' --threshold 40 --locale fr --config ./my.json
//   cairn init  --agent claude|copilot|agents|all

import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Console, Effect } from 'effect'

import { expandRoots, loadConfig } from './config.ts'
import type { AgentTarget } from './init/generate.ts'
import { runInit } from './init/generate.ts'
import { checkLinks, formatLinkReport, linkExitCode } from './program/CheckLinks.ts'
import { checkSummaries, formatSummaryReport, stampSummaries, summaryExitCode } from './program/CheckSummaries.ts'
import type { Locale } from './program/locale.ts'
import { pick } from './program/locale.ts'
import { DocsFsLive } from './io/DocsFs.ts'

interface ParsedArgs {
  readonly agent: AgentTarget
  readonly command: string
  readonly configPath: string | undefined
  readonly fix: boolean
  readonly linksOnly: boolean
  readonly locale: Locale | undefined
  readonly positionalRoots: readonly string[]
  readonly rootFlags: readonly string[]
  readonly stamp: boolean
  readonly summariesOnly: boolean
  readonly threshold: number | undefined
}

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const rootFlags: string[] = []
  const positionalRoots: string[] = []
  let command = 'check'
  let agent: AgentTarget = 'all'
  let configPath: string | undefined
  let locale: Locale | undefined
  let threshold: number | undefined
  let fix = false
  let stamp = false
  let linksOnly = false
  let summariesOnly = false

  const rest = [...argv]
  if (rest[0] !== undefined && !rest[0].startsWith('-')) {
    command = rest.shift() ?? 'check'
  }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    switch (arg) {
      case '--fix':
        fix = true
        break
      case '--stamp':
        stamp = true
        break
      case '--links-only':
        linksOnly = true
        break
      case '--summaries-only':
        summariesOnly = true
        break
      case '--root':
        rootFlags.push(rest[(i += 1)] ?? '')
        break
      case '--config':
        configPath = rest[(i += 1)]
        break
      case '--threshold':
        threshold = Number(rest[(i += 1)])
        break
      case '--locale': {
        const v = rest[(i += 1)]
        locale = v === 'fr' || v === 'en' ? v : undefined
        break
      }
      case '--agent': {
        const v = rest[(i += 1)]
        agent = v === 'claude' || v === 'copilot' || v === 'agents' || v === 'all' ? v : 'all'
        break
      }
      default:
        if (arg !== undefined && !arg.startsWith('-')) {
          positionalRoots.push(arg)
        }
    }
  }

  return {
    agent,
    command,
    configPath,
    fix,
    linksOnly,
    locale,
    positionalRoots,
    rootFlags,
    stamp,
    summariesOnly,
    threshold,
  }
}

const cwd = process.cwd()
const args = parseArgs(process.argv.slice(2))
const overrides = {
  ...(args.locale === undefined ? {} : { locale: args.locale }),
  ...(args.threshold === undefined || Number.isNaN(args.threshold) ? {} : { thresholdLines: args.threshold }),
  roots: [...args.rootFlags, ...args.positionalRoots],
}
const config = loadConfig(cwd, overrides, args.configPath)

if (args.command === 'init') {
  const result = runInit({ agent: args.agent, cwd, roots: config.roots })
  for (const file of result.written) {
    process.stdout.write(`✍️  wrote ${file}\n`)
  }
  for (const file of result.skipped) {
    process.stdout.write(`•  kept  ${file} (already present)\n`)
  }
  process.stdout.write(
    '\nNext: author your summaries, then run `cairn check --summaries-only --stamp` and `cairn check`.\n',
  )
} else {
  const absRoots = expandRoots(cwd, config.roots)
  const locale = config.locale
  const summaryArgs = {
    ignore: config.ignore,
    naming: config.naming,
    requireDirSummaries: config.requireDirSummaries,
    roots: absRoots,
    thresholdLines: config.thresholdLines,
  }

  const program = Effect.gen(function* () {
    let code = 0
    if (absRoots.length === 0) {
      yield* Console.log(
        pick(locale, {
          en: `⚠️  No documentation roots found (looked for: ${config.roots.join(', ')}).`,
          fr: `⚠️  Aucune racine de documentation trouvée (cherché : ${config.roots.join(', ')}).`,
        }),
      )
    }

    if (config.checks.links && !args.summariesOnly) {
      const links = yield* checkLinks({ fix: args.fix, ignore: config.ignore, roots: absRoots })
      yield* Console.log(formatLinkReport(links, { locale }).join('\n'))
      code = Math.max(code, linkExitCode(links))
    }

    if (config.checks.summaries && !args.linksOnly) {
      if (args.stamp) {
        const result = yield* stampSummaries(summaryArgs)
        yield* Console.log(
          pick(locale, {
            en: `🔖 Stamped ${result.stamped} summary/ies (bottom-up).`,
            fr: `🔖 ${result.stamped} résumé(s) tamponné(s) (de bas en haut).`,
          }),
        )
        if (result.missing.length > 0) {
          yield* Console.log(
            pick(locale, {
              en: `⚠️  ${result.missing.length} summary/ies to author first (content not written):`,
              fr: `⚠️  ${result.missing.length} résumé(s) à créer d'abord (contenu non rédigé) :`,
            }),
          )
          for (const node of result.missing) {
            yield* Console.log(`  - ${node.path}`)
          }
          code = 1
        }
      } else {
        const summaries = yield* checkSummaries(summaryArgs)
        yield* Console.log(formatSummaryReport(summaries, { locale, stampCommand: config.stampCommand }).join('\n'))
        code = Math.max(code, summaryExitCode(summaries))
      }
    }

    if (code !== 0) {
      yield* Effect.sync(() => (process.exitCode = code))
    }
  })

  NodeRuntime.runMain(program.pipe(Effect.provide(DocsFsLive), Effect.provide(NodeContext.layer)))
}
