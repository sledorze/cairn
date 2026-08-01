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

import type { SummaryPlan } from './core/summaries/SummaryTree.ts'
import type { Overrides } from './config.ts'
import { expandRoots, loadConfig, loadConfigWithSource, LOCALES } from './config.ts'
import { AGENT_TARGETS, runInit } from './init/generate.ts'
import { DocsFsLive } from './io/DocsFs.ts'
import type { GitFsService } from './io/Git.ts'
import { GitFs, GitFsLive } from './io/Git.ts'
import type { CheckCliFlags } from './program/checks/CheckPlugin.ts'
import type { CheckPluginRunOutcome } from './program/checks/runCheckPlugin.ts'
import { rejectedJsonMessage, runCheckPlugin } from './program/checks/runCheckPlugin.ts'
import type { LinkCheckResult } from './program/links/CheckLinks.ts'
import { linksPlugin } from './program/links/CheckLinks.ts'
import { proseRefsPlugin } from './program/links/CheckProseRefs.ts'
import { refsPlugin } from './program/links/CheckRefs.ts'
import { checkDeletions, formatDeletionsReport } from './program/summaries/CheckDeletions.ts'
import { coveragePlugin } from './program/structure/CheckCoverage.ts'
import {
  checkSummaries,
  explainSummaries,
  formatSummaryReport,
  migrateStamps,
  pruneOrphans,
  stampSummaries,
  summaryExitCode,
} from './program/summaries/CheckSummaries.ts'
import { buildJsonReport } from './program/JsonReport.ts'
import type { Locale } from './program/locale.ts'
import { pick } from './program/locale.ts'

// The 4 checks migrated onto the CheckPlugin abstraction, in the EXACT
// order their equivalent hand-wired blocks used to run (links, then —
// after summaries, which stays hand-wired, see ./program/checks/
// CheckPlugin.ts's own header — refs, proseRefs, coverage). Order matters:
// it's the order `--json` incompatibility messages are checked in
// (rejectedJsonMessage) AND the order console output appears in.
const JSON_INCOMPATIBLE_PLUGINS = [refsPlugin, proseRefsPlugin, coveragePlugin]

// Narrowed once, at module scope, instead of a `!` non-null assertion
// (forbidden by this repo's lint config) at each call site — a genuine,
// permanent fact about `refsPlugin`'s own descriptor, not a runtime
// condition, so checking it once here is the right place, not inline in
// `runCheck` every time `--refs --stamp` is handled.
const refsStamp = refsPlugin.stamp
if (refsStamp === undefined) {
  throw new Error('refsPlugin is expected to declare a stamp capability')
}

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
  Flag.withDescription('Rewrite the freshness stamp of existing summaries into their `.cairn/**` sidecar, bottom-up.'),
)
const pruneOption = Flag.boolean('prune').pipe(
  Flag.withDescription(
    'Delete orphan summaries and orphan .cairn/** sidecars (source doc deleted, renamed, or below threshold).',
  ),
)
const migrateStampsOption = Flag.boolean('migrate-stamps').pipe(
  Flag.withDescription(
    'One-off: strip the legacy in-content `<!-- source-sha256 -->` stamp from every summary, then stamp the .cairn/** sidecar tree.',
  ),
)
const explainOption = Flag.boolean('explain').pipe(
  Flag.withDescription('Explain why each stale/missing summary is not ok.'),
)
const jsonOption = Flag.boolean('json').pipe(
  Flag.withDescription('Machine-readable combined report: { summaries, links, exitCode }.'),
)
const linksOnlyOption = Flag.boolean('links-only').pipe(Flag.withDescription('Check only Markdown links.'))
const summariesOnlyOption = Flag.boolean('summaries-only').pipe(Flag.withDescription('Check only summary freshness.'))
const refsOption = Flag.boolean('refs').pipe(
  Flag.withDescription(
    'Opt-in (issue #39 Scenario I, v1/whole-file): with --stamp, record each doc\'s real reference targets\' content hashes into .cairn/**; without --stamp, report any whose target content has drifted since — "may be stale," distinct from a broken link.',
  ),
)
const proseRefsOption = Flag.boolean('prose-refs').pipe(
  Flag.withDescription(
    'Opt-in, safe for permanent use (issue #47, #105): report a bare-backtick prose file citation (e.g. `src/x.ts`, no [text](path) syntax) whose target has actually moved or been deleted — a citation that still resolves is always silent. Reported with the Markdown link syntax that would make it checkable going forward.',
  ),
)
const reportDeletionsOption = Flag.boolean('report-deletions').pipe(
  Flag.withDescription(
    'Opt-in, informational only, never affects exit code (issue #106): a doc deleted since --deletions-since (default HEAD) may have carried a heading or outbound link found nowhere else in the remaining corpus — report which, so a lossy deletion/consolidation is at least visible, not silently gone.',
  ),
)
const deletionsSinceOption = Flag.string('deletions-since').pipe(
  Flag.withDescription(
    'Git ref --report-deletions compares the working tree against. Default HEAD (catches an uncommitted deletion); pass a PR base branch (e.g. origin/main) in CI to catch deletions already committed.',
  ),
  Flag.optional,
)
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
  loadConfig(cwd, overrides, explicitPath).pipe(Effect.mapError(toConfigError))

const loadConfigWithSourceOrFail = (cwd: string, overrides: Overrides, explicitPath: string | undefined) =>
  loadConfigWithSource(cwd, overrides, explicitPath).pipe(Effect.mapError(toConfigError))

// `expandRoots` fails (issue #92) when a `..`-free, non-absolute root
// pattern resolves to a symlink escaping `cwd` — same "a bare failure must
// never surface as a raw defect" discipline as `loadConfigOrFail` above, so
// the CLI reports it as a clean one-line message + exit 1, not a stack trace.
const expandRootsOrFail = (cwd: string, patterns: readonly string[]) =>
  expandRoots(cwd, patterns).pipe(Effect.mapError(toConfigError))

// `expandRoots` throws a real Error (issue #92) when a `..`-free,
// non-absolute root pattern resolves to a symlink escaping `cwd` — same
// "a bare throw must never surface as a raw defect" discipline as
// `loadConfigOrFail` above, so the CLI reports it as a clean one-line
// message + exit 1, not a stack trace.
const expandRootsOrFail = (cwd: string, patterns: readonly string[]) =>
  Effect.try({ catch: toConfigError, try: () => expandRoots(cwd, patterns) })

interface CheckParsed {
  readonly config: Option.Option<string>
  readonly deletionsSince: Option.Option<string>
  readonly explain: boolean
  readonly fix: boolean
  readonly json: boolean
  readonly linksOnly: boolean
  readonly locale: Option.Option<Locale>
  readonly migrateStamps: boolean
  readonly prose: boolean
  readonly prune: boolean
  readonly refs: boolean
  readonly reportDeletions: boolean
  readonly root: readonly string[]
  readonly roots: readonly string[]
  readonly stamp: boolean
  readonly summariesOnly: boolean
  readonly threshold: Option.Option<number>
}

/**
 * Run a `GitFs` list method, falling back to `[]` when git is unavailable
 * or `cwd` isn't a repository — both ordinary, expected situations for a
 * tool that also works outside git entirely. Extracted (issue #93 DRY
 * audit) after `gitIgnoredDirs`/`gitWorktreeDirs` below turned up as the
 * exact same "call a GitFs method, swallow to `[]`" shape twice.
 */
const gracefulGitList = (
  list: (gitFs: GitFsService) => Effect.Effect<readonly string[], unknown, never>,
): Effect.Effect<readonly string[], never, GitFs> =>
  Effect.gen(function* () {
    const gitFs = yield* GitFs
    return yield* list(gitFs)
  }).pipe(Effect.catch(() => Effect.succeed<readonly string[]>([])))

/** `cairn check` (also the default action when no subcommand is given). */
const runCheck = Effect.fn('runCheck')(function* (parsed: CheckParsed) {
  const cwd = process.cwd()
  const overrides = overridesFrom(parsed.locale, parsed.threshold, [...parsed.root, ...parsed.roots])
  const config = yield* loadConfigOrFail(cwd, overrides, Option.getOrUndefined(parsed.config))
  const locale = config.locale

  const cliFlags: CheckCliFlags = {
    fix: parsed.fix,
    json: parsed.json,
    linksOnly: parsed.linksOnly,
    prose: parsed.prose,
    refs: parsed.refs,
    stamp: parsed.stamp,
    summariesOnly: parsed.summariesOnly,
  }

  if (parsed.json && (parsed.stamp || parsed.migrateStamps)) {
    yield* Console.log(JSON.stringify({ error: '--json cannot be combined with --stamp/--migrate-stamps' }))
    yield* Effect.sync(() => (process.exitCode = 1))
    return
  }
  // --report-deletions isn't part of the CheckPlugin registry (it needs
  // live GitFs, which the registry deliberately keeps out — see its own
  // wiring below), so it can't share `rejectedJsonMessage`'s generic check;
  // one hand-written guard, same shape the registry replaced 3 of.
  if (parsed.json && parsed.reportDeletions) {
    yield* Console.log(JSON.stringify({ error: '--json cannot be combined with --report-deletions' }))
    yield* Effect.sync(() => (process.exitCode = 1))
    return
  }
  // Replaces 3 near-identical hand-written guards (--refs/--prose-refs/
  // checks.coverage) with one generic, order-preserving check — each
  // migrated plugin owns its own `jsonUnsupportedMessage`
  // (./program/checks/CheckPlugin.ts), so a NEW plugin never needs a 4th
  // copy-pasted `if` here.
  const jsonRejection = rejectedJsonMessage(JSON_INCOMPATIBLE_PLUGINS, config, cliFlags)
  if (jsonRejection !== null) {
    yield* Console.log(JSON.stringify({ error: jsonRejection }))
    yield* Effect.sync(() => (process.exitCode = 1))
    return
  }

  const absRoots = yield* expandRootsOrFail(cwd, config.roots)

  // Issue #48: a hard error, never a silent fallback — someone who enabled
  // `onlyGitTracked` needs to know immediately if it isn't actually filtering
  // anything (e.g. `git` missing, or `cwd` not a repository), not discover it
  // later as an inexplicably-passing check.
  const trackedFiles = config.onlyGitTracked
    ? yield* Effect.gen(function* () {
        const gitFs = yield* GitFs
        return yield* gitFs.listTrackedFiles(cwd)
      }).pipe(
        Effect.mapError(
          (error) =>
            new CairnConfigError({
              message: `cairn: onlyGitTracked is enabled but git is unavailable at ${cwd}: ${error.message}`,
            }),
        ),
      )
    : undefined

  // Issue #63: unlike `onlyGitTracked` above, both of these are an
  // always-on default safety net, not an opt-in guarantee — so each
  // degrades gracefully (falls back to `config.ignore` alone) rather than
  // hard-failing when git is unavailable or `cwd` isn't a repository, both
  // ordinary, expected situations for a tool that also works outside git
  // entirely. `gitWorktreeDirs`: a linked worktree (e.g.
  // `.claude/worktrees/<name>`) nests a full second copy of the repo's own
  // doc tree and must never be walked, whether or not the caller
  // configured anything for it.
  const gitIgnoredDirs = yield* gracefulGitList((gitFs) => gitFs.listIgnoredDirs(cwd))
  const gitWorktreeDirs = yield* gracefulGitList((gitFs) => gitFs.listWorktreeDirs(cwd))

  const effectiveIgnore = [
    ...config.ignore,
    ...gitIgnoredDirs.map((dir) => `${dir}/**`),
    ...gitWorktreeDirs.map((dir) => `${dir}/**`),
  ]

  const summaryArgs = {
    base: cwd,
    ignore: effectiveIgnore,
    naming: config.naming,
    requireDirSummaries: config.requireDirSummaries,
    roots: absRoots,
    thresholdLines: config.thresholdLines,
    ...(trackedFiles === undefined ? {} : { trackedFiles }),
  }

  let code = 0
  let linksResult: LinkCheckResult | null = null
  let summariesResult: SummaryPlan | null = null

  // Every `runCheckPlugin` call site (links/refs/proseRefs/coverage) prints
  // its lines (if any) and folds its exit code into the running `code` the
  // exact same way — extracted (issue #93 DRY audit) after this shape
  // turned up identically 4 times. Links additionally captures its own
  // `result` for `--json`'s report, kept as separate glue at that one call
  // site rather than folded in here.
  const reportOutcome = (outcome: CheckPluginRunOutcome<unknown>) =>
    Effect.gen(function* () {
      if (!outcome.ran) {
        return
      }
      if (outcome.lines.length > 0) {
        yield* Console.log(outcome.lines.join('\n'))
      }
      code = Math.max(code, outcome.code)
    })

  // A config that resolves to checking literally nothing must fail loudly,
  // not report green — found adversarially (goal: "refute the DX for end
  // users (dev/ai) is great"): this used to be a warning-only line with no
  // effect on `code`, so a totally misconfigured repo (or one where the
  // scan just silently found nothing) passed CI by exit code alone, the one
  // thing automation actually checks. `--json` still suppresses the
  // human-readable line (matching every other warning's `--json` behavior),
  // but `code` — and so `report.exitCode` below — reflects the failure
  // either way.
  if (absRoots.length === 0) {
    code = Math.max(code, 1)
    if (!parsed.json) {
      yield* Console.log(
        pick(locale, {
          en: `⚠️  No documentation roots found (looked for: ${config.roots.join(', ')}).`,
          fr: `⚠️  Aucune racine de documentation trouvée (cherché : ${config.roots.join(', ')}).`,
        }),
      )
    }
  }

  // Shared by every plugin-driven check below — same base/roots/ignore/
  // trackedFiles/config/cli every hand-wired block used to thread through
  // individually.
  const pluginArgs = {
    base: cwd,
    cli: cliFlags,
    ignore: effectiveIgnore,
    resolved: config,
    roots: absRoots,
    ...(trackedFiles === undefined ? {} : { trackedFiles }),
  }

  // Hand-wired, not a CheckPlugin (needs live GitFs — see the --json guard
  // above). Never contributes to `code` (issue #106: informational only,
  // `deletionsExitCode` always 0) — a report, not a verdict. A
  // `GitUnavailableError` here is caught LOCALLY, never mapped to a
  // `CairnConfigError` that would propagate — found via adversarial
  // review: an earlier version did exactly that, which aborted the ENTIRE
  // `runCheck` generator on failure, silently skipping every later step
  // (the --json report, and critically the final `if (code !== 0)`
  // exit-code assignment) — a purely informational, opt-in flag was able
  // to make a real links/summaries failure exit 0. Degrading to a printed
  // warning keeps every other section's result and exit code intact
  // regardless of whether this one succeeds.
  //
  // COMPUTED here, BEFORE `linksOutcome`/`--fix` runs, deliberately — found
  // via a SECOND adversarial review: `--fix` physically rewrites doc
  // content (`CheckLinks.ts`'s `dfs.writeFile`) before `checkDeletions`
  // re-reads the corpus from disk. `findDeletedDocContent`'s "does this
  // heading/link target survive ANYWHERE else" check is coarse by design
  // (a structural match, not a semantic one) — an unrelated doc's broken
  // link that `--fix` just repaired to coincidentally point at the SAME
  // target a deleted doc used to link to would silently count as
  // "surviving," making `cairn check --fix --report-deletions`
  // systematically under-report real orphaned link targets compared to
  // running the two separately. Reading the corpus before `--fix` mutates
  // anything closes that gap; reproduced directly (a real scratch repo,
  // both flag orders) before this reordering, confirmed fixed after.
  //
  // PRINTED later, right before the `--json` block (its ORIGINAL position,
  // after every other check's own output) — deliberately NOT moved
  // alongside the computation above: this repo's established output order
  // puts every other check's (potentially blocking) findings before this
  // one's (always informational) report, and there's no correctness
  // reason to disturb that just because the computation itself needed to
  // move earlier.
  const deletionsOutcome = parsed.reportDeletions
    ? yield* checkDeletions({
        base: cwd,
        ignore: effectiveIgnore,
        naming: config.naming,
        ref: Option.getOrElse(parsed.deletionsSince, () => 'HEAD'),
        roots: absRoots,
        ...(trackedFiles === undefined ? {} : { trackedFiles }),
      }).pipe(
        Effect.map((result) => ({ error: null, result })),
        Effect.catch((error) => Effect.succeed({ error, result: null })),
      )
    : null

  const linksOutcome = yield* runCheckPlugin(linksPlugin, pluginArgs)
  if (linksOutcome.ran) {
    // `buildJsonReport` (below) treats `linksResult === null` as "the links
    // check didn't run" — a real, established `X | null` "skipped" sentinel
    // at THIS specific boundary (matches `summariesResult`'s own convention
    // just above), not the ambiguous one `runCheckPlugin`'s own return type
    // no longer has.
    linksResult = linksOutcome.result
  }
  yield* reportOutcome(linksOutcome)

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
    if (parsed.migrateStamps) {
      const result = yield* migrateStamps(summaryArgs)
      yield* Console.log(
        pick(locale, {
          en: `🔄 Migrated ${result.migrated} legacy in-content stamp(s) off; stamped ${result.stamped} summary/ies (sidecar, bottom-up).`,
          fr: `🔄 ${result.migrated} ancien(s) tampon(s) intégré(s) migré(s) ; ${result.stamped} résumé(s) tamponné(s) (fichier annexe, de bas en haut).`,
        }),
      )
    } else if (parsed.stamp) {
      const result = yield* stampSummaries(summaryArgs)
      yield* Console.log(
        pick(locale, {
          en: `🔖 Stamped ${result.stamped} summary/ies (.cairn/** sidecar, bottom-up).`,
          fr: `🔖 ${result.stamped} résumé(s) tamponné(s) (fichier annexe .cairn/**, de bas en haut).`,
        }),
      )
      if (result.migrated > 0) {
        yield* Console.log(
          pick(locale, {
            en: `🔄 Also cleaned up ${result.migrated} legacy in-content stamp(s) along the way — nothing else to do.`,
            fr: `🔄 ${result.migrated} ancien(s) tampon(s) intégré(s) nettoyé(s) au passage — rien d'autre à faire.`,
          }),
        )
      }
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

  // refs is the one migrated check with a `--stamp` verb of its own (a
  // different write-time operation, not part of the run/format/exitCode
  // shape `runCheckPlugin` drives — see refsPlugin's own `stamp` doc
  // comment) — never contributes to `code`, matching summaries' own
  // `--stamp` branch above.
  if (parsed.refs) {
    if (parsed.stamp) {
      const lines = yield* refsStamp(pluginArgs)
      yield* Console.log(lines.join('\n'))
    } else {
      yield* reportOutcome(yield* runCheckPlugin(refsPlugin, pluginArgs))
    }
  }

  yield* reportOutcome(yield* runCheckPlugin(proseRefsPlugin, pluginArgs))

  yield* reportOutcome(yield* runCheckPlugin(coveragePlugin, pluginArgs))

  if (deletionsOutcome !== null) {
    if (deletionsOutcome.error !== null) {
      // Deliberately NOT "git unavailable at X" — `GitUnavailableError` is
      // also what an unresolvable REF raises (e.g. `--deletions-since
      // origin/main` under a shallow CI checkout that never fetched
      // `main`), and asserting "git unavailable" for that case is actively
      // misleading: git is fine, the ref just isn't there (issue #106
      // "best value defaults" audit — this is the single most likely
      // real-world failure mode of this flag, per its own README section).
      // The underlying message already names the real cause either way.
      yield* Console.log(
        pick(locale, {
          en: `⚠️  --report-deletions skipped: ${deletionsOutcome.error.message}`,
          fr: `⚠️  --report-deletions ignoré : ${deletionsOutcome.error.message}`,
        }),
      )
    } else {
      yield* Console.log(formatDeletionsReport(deletionsOutcome.result, { locale }).join('\n'))
    }
  }

  if (parsed.json) {
    const report = buildJsonReport({ links: linksResult, summaries: summariesResult })
    // `Math.max`, not `report.exitCode` alone — `report.exitCode` is
    // derived purely from links/summaries, so using it verbatim would
    // silently discard any OTHER contribution to `code` (today: the
    // zero-resolved-roots check above, the only such case reachable under
    // `--json`, since refs/proseRefs/coverage are all already rejected
    // upfront when `--json` is set). The printed JSON body's own
    // `exitCode` field is corrected too, not just `process.exitCode` below
    // — a consumer reading only the JSON body must see the same number the
    // process actually exits with, not a stale one.
    const exitCode = Math.max(code, report.exitCode)
    yield* Console.log(JSON.stringify({ ...report, exitCode }, null, 2))
    code = exitCode
  }

  if (code !== 0) {
    yield* Effect.sync(() => (process.exitCode = code))
  }
})

const checkConfigShape = {
  config: configPathOption,
  deletionsSince: deletionsSinceOption,
  explain: explainOption,
  fix: fixOption,
  json: jsonOption,
  linksOnly: linksOnlyOption,
  locale: localeOption,
  migrateStamps: migrateStampsOption,
  prose: proseRefsOption,
  prune: pruneOption,
  refs: refsOption,
  reportDeletions: reportDeletionsOption,
  root: rootOption,
  roots: rootsArgs,
  stamp: stampOption,
  summariesOnly: summariesOnlyOption,
  threshold: thresholdOption,
}

const checkCommand = Command.make('check', checkConfigShape, runCheck).pipe(
  Command.withDescription(
    'Check hierarchical doc summaries and Markdown links (the default action). Also runs config-only checks with no flag of their own, when configured in .cairnrc.json: checks.coverage (structural doc-kind coverage/orphan detection — see README or the JSON schema for its keys).',
  ),
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
  const result = yield* runInit({ agent, cwd, roots: config.roots }).pipe(Effect.mapError(toConfigError))
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
  const absRoots = yield* expandRootsOrFail(cwd, config.roots)
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
  Effect.provide(GitFsLive),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
)
