// The generic runner behind cli.ts's 4 migrated check call sites
// (links/refs/proseRefs/coverage — see ./CheckPlugin.ts's own header for
// why `summaries` stays outside this abstraction).

import { Effect } from 'effect'

import type { ResolvedConfig } from '../../core/Config.ts'
import type { DocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags, CheckPlugin, CheckPluginMeta, CheckRunArgs } from './CheckPlugin.ts'

// A discriminated union, not a flat `{ ran: boolean; result: Result | null }`
// — the flat shape used `result: null` as a "didn't run" sentinel, which is
// structurally ambiguous the instant a real `Result` type could itself
// legitimately be `null` (not hypothetical: `CoverageConfig | null` exists
// elsewhere in this exact codebase). With `ran` as the discriminant, a
// disabled outcome has no `result` FIELD at all — TypeScript itself refuses
// to let a caller read `.result` without first narrowing on `.ran`, so this
// ambiguity is unrepresentable rather than merely undocumented.
export type CheckPluginRunOutcome<Result> =
  | { readonly ran: false }
  | {
      readonly code: number
      /** Empty under `--json` even for a plugin that ran — matches today's
       * exact `if (!parsed.json) { Console.log(...) }` behavior. */
      readonly lines: readonly string[]
      readonly ran: true
      /** The RAW result — `buildJsonReport` needs it for the one plugin
       * (links) that still participates in `--json` output; the other
       * three can never reach this function under `--json` at all (see
       * `rejectedJsonMessage`, called upfront by cli.ts before any plugin
       * runs). */
      readonly result: Result
    }

export const runCheckPlugin = <Result, Env = DocsFs>(
  plugin: CheckPlugin<Result, Env>,
  args: CheckRunArgs,
): Effect.Effect<CheckPluginRunOutcome<Result>, never, Env> =>
  Effect.gen(function* () {
    if (!plugin.isEnabled(args.resolved, args.cli)) {
      return { ran: false }
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
