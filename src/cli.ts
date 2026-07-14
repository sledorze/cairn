#!/usr/bin/env node
// CLI entrypoint for cairn: hierarchical documentation summaries + dead-link
// checking, `init` to scaffold agent guidance, `config` to debug config
// resolution. Built on @effect/cli: --help, --version and shell completions are
// generated from the Options/Args declared below, so they can't drift from the
// actual flags. Decision logic is unit-tested in the sibling core/program
// modules; this file is the thin CLI shell (Options/Args -> handler).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { Args, Command, Options } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Console, Effect, Option } from 'effect'

import type { SummaryPlan } from './core/SummaryTree.ts'
import type { Overrides } from './config.ts'
import { expandRoots, loadConfig, loadConfigWithSource, LOCALES } from './config.ts'
import { AGENT_TARGETS, runInit } from './init/generate.ts'
import type { DocsFs } from './io/DocsFs.ts'
import { DocsFsLive } from './io/DocsFs.ts'
import type { LinkCheckResult } from './program/CheckLinks.ts'
import { checkLinks, formatLinkReport, linkExitCode } from './program/CheckLinks.ts'
import {
  checkSummaries,
  explainSummaries,
  formatSummaryReport,
  pruneOrphans,
  stampSummaries,
  summaryExitCode,
} from './program/CheckSummaries.ts'
import { buildJsonReport } from './program/JsonReport.ts'
import type { Locale } from './program/locale.ts'
import { pick } from './program/locale.ts'

// --- shared `check` options/args ---

const rootsArgs = Args.text({ name: 'roots' }).pipe(
  Args.withDescription('Documentation root(s) to check (globs allowed); falls back to config `roots`.'),
  Args.repeated,
)
const rootOption = Options.text('root').pipe(
  Options.withDescription('Add a documentation root (repeatable); merged with positional roots.'),
  Options.repeated,
)
const fixOption = Options.boolean('fix').pipe(Options.withDescription('Auto-repair unambiguous dead links.'))
const stampOption = Options.boolean('stamp').pipe(
  Options.withDescription('Rewrite `source-sha256` stamps of existing summaries, bottom-up.'),
)
const pruneOption = Options.boolean('prune').pipe(
  Options.withDescription('Delete orphan summaries (source doc deleted, renamed, or below threshold).'),
)
const explainOption = Options.boolean('explain').pipe(
  Options.withDescription('Explain why each stale/missing summary is not ok.'),
)
const jsonOption = Options.boolean('json').pipe(
  Options.withDescription('Machine-readable combined report: { summaries, links, exitCode }.'),
)
const linksOnlyOption = Options.boolean('links-only').pipe(Options.withDescription('Check only Markdown links.'))
const summariesOnlyOption = Options.boolean('summaries-only').pipe(
  Options.withDescription('Check only summary freshness.'),
)
const configPathOption = Options.text('config').pipe(
  Options.withDescription('Path to a config file (default: .cairnrc.json / .cairnrc / package.json#cairn).'),
  Options.optional,
)
const thresholdOption = Options.integer('threshold').pipe(
  Options.withDescription('Line count above which a file needs a summary (overrides config).'),
  Options.optional,
)
const localeOption = Options.choice('locale', LOCALES).pipe(
  Options.withDescription('Report language (overrides config).'),
  Options.optional,
)

/** The `{ locale?, thresholdLines?, roots }` shape `loadConfig`/`loadConfigWithSource`
 * expect, built from the CLI's `Option`-wrapped overrides once instead of at each call site. */
const overridesFrom = (
  locale: Option.Option<Locale>,
  threshold: Option.Option<number>,
  roots: readonly string[],
): Overrides => ({
  ...(Option.isSome(locale) ? { locale: locale.value } : {}),
  ...(Option.isSome(threshold) ? { thresholdLines: threshold.value } : {}),
  roots,
})

// `loadConfig`/`loadConfigWithSource` throw a human-readable `Error` on invalid config
// (unknown key, bad `extends`, ...). Lifted into Effect's error channel so every command
// reports it the same clean way — a bare `throw` would otherwise surface as an unhandled
// Effect defect (a stack trace) instead of a one-line message + exit 1.
const toMessage = (error: unknown): string => (error as Error).message

const loadConfigOrFail = (cwd: string, overrides: Overrides, explicitPath: string | undefined) =>
  Effect.try({ catch: toMessage, try: () => loadConfig(cwd, overrides, explicitPath) })

const loadConfigWithSourceOrFail = (cwd: string, overrides: Overrides, explicitPath: string | undefined) =>
  Effect.try({ catch: toMessage, try: () => loadConfigWithSource(cwd, overrides, explicitPath) })

const reportConfigErrorAndExit = (message: string): Effect.Effect<void> =>
  Effect.zipRight(
    Console.error(message),
    Effect.sync(() => (process.exitCode = 1)),
  )

interface CheckParsed {
  readonly config: Option.Option<string>
  readonly explain: boolean
  readonly fix: boolean
  readonly json: boolean
  readonly linksOnly: boolean
  readonly locale: Option.Option<Locale>
  readonly prune: boolean
  readonly root: readonly string[]
  readonly roots: readonly string[]
  readonly stamp: boolean
  readonly summariesOnly: boolean
  readonly threshold: Option.Option<number>
}

/** `cairn check` (also the default action when no subcommand is given). */
const runCheck = (parsed: CheckParsed): Effect.Effect<void, never, DocsFs> =>
  Effect.gen(function* () {
    const cwd = process.cwd()
    const overrides = overridesFrom(parsed.locale, parsed.threshold, [...parsed.root, ...parsed.roots])
    const config = yield* loadConfigOrFail(cwd, overrides, Option.getOrUndefined(parsed.config))
    const locale = config.locale

    if (parsed.json && parsed.stamp) {
      yield* Console.log(JSON.stringify({ error: '--json cannot be combined with --stamp' }))
      yield* Effect.sync(() => (process.exitCode = 1))
      return
    }

    const absRoots = expandRoots(cwd, config.roots)
    const summaryArgs = {
      ignore: config.ignore,
      naming: config.naming,
      requireDirSummaries: config.requireDirSummaries,
      roots: absRoots,
      thresholdLines: config.thresholdLines,
    }

    let code = 0
    let linksResult: LinkCheckResult | null = null
    let summariesResult: SummaryPlan | null = null

    if (absRoots.length === 0 && !parsed.json) {
      yield* Console.log(
        pick(locale, {
          en: `⚠️  No documentation roots found (looked for: ${config.roots.join(', ')}).`,
          fr: `⚠️  Aucune racine de documentation trouvée (cherché : ${config.roots.join(', ')}).`,
        }),
      )
    }

    if (config.checks.links && !parsed.summariesOnly) {
      const links = yield* checkLinks({ fix: parsed.fix, ignore: config.ignore, roots: absRoots })
      linksResult = links
      if (!parsed.json) {
        yield* Console.log(formatLinkReport(links, { locale }).join('\n'))
      }
      code = Math.max(code, linkExitCode(links))
    }

    if (config.checks.summaries && !parsed.linksOnly) {
      if (parsed.prune) {
        const removed = yield* pruneOrphans(summaryArgs)
        if (!parsed.json) {
          yield* Console.log(
            pick(locale, {
              en: `🗑  removed ${removed} orphan summary/ies.`,
              fr: `🗑  ${removed} résumé(s) orphelin(s) supprimé(s).`,
            }),
          )
        }
      }
      if (parsed.stamp) {
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
        summariesResult = summaries
        if (!parsed.json) {
          yield* Console.log(formatSummaryReport(summaries, { locale, stampCommand: config.stampCommand }).join('\n'))
          if (parsed.explain && summaries.todo.length > 0) {
            const explanation = yield* explainSummaries(summaryArgs, { locale })
            yield* Console.log(explanation.join('\n'))
          }
        }
        code = Math.max(code, summaryExitCode(summaries))
      }
    }

    if (parsed.json) {
      const report = buildJsonReport({ links: linksResult, summaries: summariesResult })
      yield* Console.log(JSON.stringify(report, null, 2))
      code = report.exitCode
    }

    if (code !== 0) {
      yield* Effect.sync(() => (process.exitCode = code))
    }
  }).pipe(Effect.catchAll(reportConfigErrorAndExit))

const checkConfigShape = {
  config: configPathOption,
  explain: explainOption,
  fix: fixOption,
  json: jsonOption,
  linksOnly: linksOnlyOption,
  locale: localeOption,
  prune: pruneOption,
  root: rootOption,
  roots: rootsArgs,
  stamp: stampOption,
  summariesOnly: summariesOnlyOption,
  threshold: thresholdOption,
}

const checkCommand = Command.make('check', checkConfigShape, runCheck).pipe(
  Command.withDescription('Check hierarchical doc summaries and Markdown links (the default action).'),
)

// --- `init` ---

const agentOption = Options.choice('agent', AGENT_TARGETS).pipe(
  Options.withDescription('Which agent(s) to scaffold guidance for.'),
  Options.withDefault('all'),
)

const initCommand = Command.make(
  'init',
  { agent: agentOption, config: configPathOption, root: rootOption },
  ({ agent, config: configPath, root }) =>
    Effect.gen(function* () {
      const cwd = process.cwd()
      const config = yield* loadConfigOrFail(cwd, { roots: [...root] }, Option.getOrUndefined(configPath))
      const result = runInit({ agent, cwd, roots: config.roots })
      for (const file of result.written) {
        yield* Console.log(`✍️  wrote ${file}`)
      }
      for (const file of result.skipped) {
        yield* Console.log(`•  kept  ${file} (already present)`)
      }
      yield* Console.log(
        '\nNext: author your summaries, then run `cairn check --summaries-only --stamp` and `cairn check`.',
      )
    }).pipe(Effect.catchAll(reportConfigErrorAndExit)),
).pipe(Command.withDescription('Scaffold agent guidance (Claude Code, GitHub Copilot, AGENTS.md/OpenCode).'))

// --- `config` ---

const configPathArg = Args.text({ name: 'path' }).pipe(
  Args.withDescription('Optional path to a config file (overrides the default lookup).'),
  Args.optional,
)

const configCommand = Command.make(
  'config',
  { config: configPathOption, locale: localeOption, path: configPathArg, root: rootOption, threshold: thresholdOption },
  ({ config: configFlag, locale, path: rcPath, root, threshold }) =>
    Effect.gen(function* () {
      const cwd = process.cwd()
      const explicitPath = Option.getOrUndefined(configFlag) ?? Option.getOrUndefined(rcPath)
      const overrides = overridesFrom(locale, threshold, [...root])
      const { config, sourceFile } = yield* loadConfigWithSourceOrFail(cwd, overrides, explicitPath)
      const absRoots = expandRoots(cwd, config.roots)
      yield* Console.log(`source: ${sourceFile}`)
      yield* Console.log(`roots (configured): ${JSON.stringify(config.roots)}`)
      yield* Console.log(`roots (expanded):   ${JSON.stringify(absRoots)}`)
      yield* Console.log(JSON.stringify(config, null, 2))
    }).pipe(Effect.catchAll(reportConfigErrorAndExit)),
).pipe(
  Command.withDescription(
    'Print the resolved config, which file it came from, and expanded roots (debug "why aren\'t my docs checked").',
  ),
)

// --- top-level: bare `cairn` behaves like `cairn check` ---

const cairn = Command.make('cairn', checkConfigShape, runCheck).pipe(
  Command.withSubcommands([checkCommand, initCommand, configCommand]),
)

// Read the version from package.json (one directory up from this file in both
// `tsx src/cli.ts` dev runs and the built `dist/cli.js`) so it can't drift.
const packageJsonPath = path.join(import.meta.dirname, '..', 'package.json')
const { version } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string }

const cli = Command.run(cairn, { name: 'cairn', version })

cli(process.argv).pipe(Effect.provide(DocsFsLive), Effect.provide(NodeContext.layer), NodeRuntime.runMain)
