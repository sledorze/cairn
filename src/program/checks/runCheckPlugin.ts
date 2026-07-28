// The generic runner behind cli.ts's 4 migrated check call sites
// (links/refs/proseRefs/coverage — see ./CheckPlugin.ts's own header for
// why `summaries` stays outside this abstraction).

import { Effect } from 'effect'

import type { ResolvedConfig } from '../../core/Config.ts'
import type { DocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags, CheckPlugin, CheckPluginMeta, CheckRunArgs } from './CheckPlugin.ts'

export interface CheckPluginRunOutcome<Result> {
  readonly code: number
  /** Empty under `--json` even for a plugin that ran — matches today's
   * exact `if (!parsed.json) { Console.log(...) }` behavior. */
  readonly lines: readonly string[]
  /** False when `isEnabled` was false — the plugin's `run` was never
   * invoked at all, not run-and-discarded. */
  readonly ran: boolean
  /** The RAW result, always present when `ran` is true, `--json` or not —
   * `buildJsonReport` needs it for the one plugin (links) that still
   * participates in `--json` output; the other three can never reach this
   * function under `--json` at all (see `rejectedJsonMessage`, called
   * upfront by cli.ts before any plugin runs). */
  readonly result: Result | null
}

export const runCheckPlugin = <Result>(
  plugin: CheckPlugin<Result>,
  args: CheckRunArgs,
): Effect.Effect<CheckPluginRunOutcome<Result>, never, DocsFs> =>
  Effect.gen(function* () {
    if (!plugin.isEnabled(args.resolved, args.cli)) {
      return { code: 0, lines: [], ran: false, result: null }
    }
    const result = yield* plugin.run(args)
    const lines = args.cli.json ? [] : plugin.format(result, { locale: args.resolved.locale })
    return { code: plugin.exitCode(result), lines, ran: true, result }
  })

/** The upfront `--json` compatibility gate, run once before any plugin
 * executes — matches cli.ts's existing pattern of checking `parsed.json &&
 * parsed.refs` / `parsed.json && parsed.prose` / `parsed.json &&
 * config.checks.coverage !== null`, in that exact sequence, each returning
 * immediately with its own message. Returns the FIRST enabled,
 * incompatible plugin's message in `plugins` order, or `null` when nothing
 * blocks `--json` (including when `--json` itself wasn't requested, or the
 * incompatible plugin exists but isn't enabled this run). */
export const rejectedJsonMessage = (
  plugins: readonly CheckPluginMeta[],
  resolved: ResolvedConfig,
  cli: CheckCliFlags,
): string | null => {
  if (!cli.json) {
    return null
  }
  for (const plugin of plugins) {
    if (plugin.jsonUnsupportedMessage !== undefined && plugin.isEnabled(resolved, cli)) {
      return plugin.jsonUnsupportedMessage
    }
  }
  return null
}
