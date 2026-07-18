#!/usr/bin/env node
// CLI entrypoint for cairn: hierarchical documentation summaries + dead-link
// checking, `init` to scaffold agent guidance, `config` to debug config
// resolution. Built on effect/unstable/cli: --help, --version and shell
// completions are generated from the Flag/Argument declared below, so they
// can't drift from the actual flags. Decision logic is unit-tested in the
// sibling core/program modules; this file is the thin CLI shell
// (Flag/Argument -> handler).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Console, Data, Effect, Option, Runtime } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'

import type { SummaryPlan } from './core/SummaryTree.ts'
import type { Overrides } from './config.ts'
import { expandRoots, loadConfig, loadConfigWithSource, LOCALES } from './config.ts'
import { AGENT_TARGETS, runInit } from './init/generate.ts'
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

// --- shared `check` flags/args ---

const rootsArgs = Argument.string('roots').pipe(
  Argument.withDescription('Documentation root(s) to check (globs allowed); falls back to config `roots`.'),
  Argument.variadic(),
)
const rootOption = Flag.string('root').pipe(
  Flag.withDescription('Add a documentation root (repeatable); merged with positional roots.'),
  Flag.atLeast(0),
)
const fixOption = Flag.boolean('fix').pipe(Flag.withDescription('Auto-repair unambiguous dead links.'))
const stampOption = Flag.boolean('stamp').pipe(
  Flag.withDescription('Rewrite `source-sha256` stamps of existing summaries, bottom-up.'),
)
const pruneOption = Flag.boolean('prune').pipe(
  Flag.withDescription('Delete orphan summaries (source doc deleted, renamed, or below threshold).'),
)
const explainOption = Flag.boolean('explain').pipe(
  Flag.withDescription('Explain why each stale/missing summary is not ok.'),
)
const jsonOption = Flag.boolean('json').pipe(
  Flag.withDescription('Machine-readable combined report: { summaries, links, exitCode }.'),
)
const linksOnlyOption = Flag.boolean('links-only').pipe(Flag.withDescription('Check only Markdown links.'))
const summariesOnlyOption = Flag.boolean('summaries-only').pipe(Flag.withDescription('Check only summary freshness.'))
const configPathOption = Flag.string('config').pipe(
  Flag.withDescription('Path to a config file (default: .cairnrc.json / .cairnrc / package.json#cairn).'),
  Flag.optional,
)
const thresholdOption = Flag.integer('threshold').pipe(
  Flag.withDescription('Line count above which a file needs a summary (overrides config).'),
  Flag.optional,
)
const localeOption = Flag.choice('locale', LOCALES).pipe(
  Flag.withDescription('Report language (overrides config).'),
  Flag.optional,
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
// Effect defect (a stack trace) instead of a one-line message + exit 1. `errorReported =
// false` tells `NodeRuntime.runMain`'s default teardown not to also log the Cause: the
// single `Console.error` at the bottom of this file (where every command's error channel
// converges) is the only place this message is printed.
class CairnConfigError extends Data.TaggedError('CairnConfigError')<{ readonly message: string }> {
  readonly [Runtime.errorReported] = false
}

const toConfigError = (error: unknown): CairnConfigError => new CairnConfigError({ message: (error as Error).message })

const loadConfigOrFail = (cwd: string, overrides: Overrides, explicitPath: string | undefined) =>
  Effect.try({ catch: toConfigError, try: () => loadConfig(cwd, overrides, explicitPath) })

const loadConfigWithSourceOrFail = (cwd: string, overrides: Overrides, explicitPath: string | undefined) =>
  Effect.try({ catch: toConfigError, try: () => loadConfigWithSource(cwd, overrides, explicitPath) })

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
const runCheck = Effect.fn('runCheck')(function* (parsed: CheckParsed) {
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
})

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

const agentOption = Flag.choice('agent', AGENT_TARGETS).pipe(
  Flag.withDescription('Which agent(s) to scaffold guidance for.'),
  Flag.withDefault('all'),
)

interface InitParsed {
  readonly agent: (typeof AGENT_TARGETS)[number]
  readonly config: Option.Option<string>
  readonly root: readonly string[]
}

const runInitCommand = Effect.fn('runInit')(function* ({ agent, config: configPath, root }: InitParsed) {
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
})

const initCommand = Command.make(
  'init',
  { agent: agentOption, config: configPathOption, root: rootOption },
  runInitCommand,
).pipe(Command.withDescription('Scaffold agent guidance (Claude Code, GitHub Copilot, AGENTS.md/OpenCode).'))

// --- `config` ---

const configPathArg = Argument.string('path').pipe(
  Argument.withDescription('Optional path to a config file (overrides the default lookup).'),
  Argument.optional,
)

interface ConfigParsed {
  readonly config: Option.Option<string>
  readonly locale: Option.Option<Locale>
  readonly path: Option.Option<string>
  readonly root: readonly string[]
  readonly threshold: Option.Option<number>
}

const runConfigCommand = Effect.fn('runConfig')(function* ({
  config: configFlag,
  locale,
  path: rcPath,
  root,
  threshold,
}: ConfigParsed) {
  const cwd = process.cwd()
  const explicitPath = Option.getOrUndefined(configFlag) ?? Option.getOrUndefined(rcPath)
  const overrides = overridesFrom(locale, threshold, [...root])
  const { config, sourceFile } = yield* loadConfigWithSourceOrFail(cwd, overrides, explicitPath)
  const absRoots = expandRoots(cwd, config.roots)
  yield* Console.log(`source: ${sourceFile}`)
  yield* Console.log(`roots (configured): ${JSON.stringify(config.roots)}`)
  yield* Console.log(`roots (expanded):   ${JSON.stringify(absRoots)}`)
  yield* Console.log(JSON.stringify(config, null, 2))
})

const configCommand = Command.make(
  'config',
  { config: configPathOption, locale: localeOption, path: configPathArg, root: rootOption, threshold: thresholdOption },
  runConfigCommand,
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

// Every command's error channel converges here as `CairnConfigError | CliError.CliError`;
// this is the single place that prints an invalid-config message (see the class above) —
// `NodeRuntime.runMain`'s own error reporting is suppressed for it via `errorReported`.
cairn.pipe(
  Command.run({ version }),
  Effect.tapErrorTag('CairnConfigError', (error) => Console.error(error.message)),
  Effect.provide(DocsFsLive),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
)
