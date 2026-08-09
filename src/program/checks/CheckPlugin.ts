// The check-plugin abstraction — extracted from cli.ts's 4 near-identical
// hand-wired if-blocks (links/refs/proseRefs/coverage — see docs/adr/0003
// for the full rationale, including why `summaries` deliberately stays
// OUTSIDE this abstraction: it has four distinct CLI verbs —
// check/stamp/prune/migrate-stamps — that don't fit this single
// run/format/exitCode shape, and forcing them to fit would be exactly the
// "force a false generality" mistake this design otherwise exists to avoid).
//
// Lives in `program/`, not `core/`, despite being "just types": every
// method's signature involves `Effect`/`DocsFs` (the scheduled, effectful
// part of the library) — the same reasoning `core/Config.ts`'s own `Locale`
// comment gives for why IT stays in `core/` (a plain union of string
// literals) while this file, which is NOT IO-free, doesn't.
//
// Each plugin owns its OWN `isEnabled`/`jsonUnsupportedMessage` — cli.ts no
// longer hand-repeats `parsed.json && parsed.refs` / `parsed.json &&
// parsed.prose` / `parsed.json && config.checks.coverage !== null` as three
// near-identical guards; one generic check does it for every plugin.
//
// Deliberately NOT included (see docs/adr/0003's "Decision" section, "No
// shared doc-scan context, no dependsOn"): a shared, once-computed doc-scan
// context. No two of the four migrated
// plugins actually consume the same scan today — links/refs/proseRefs each
// read raw file content directly; coverage extracts DocMetadata. Building a
// shared-context/dependency-declaration mechanism now, for a consumer that
// doesn't exist yet, would be exactly the premature generality this
// increment's own adversarial review (docs/adr/0003) keeps finding and
// fixing after the fact — better to add it when a real second structure-
// consuming plugin (e.g. a future stale-coverage-link check) actually needs it.

import type { Effect } from 'effect'

import type { Locale, ResolvedConfig } from '../../core/Config.ts'
import type { DocsFs } from '../../io/DocsFs.ts'

/** Everything a plugin's `isEnabled`/`run` might need from the parsed CLI
 * flags — a deliberately NARROW slice of cli.ts's full `CheckParsed`, not
 * the whole thing, so a plugin can't reach into a flag that has nothing to
 * do with it (e.g. `--prune`, which only `summaries` — outside this
 * abstraction entirely — understands). */
export interface CheckCliFlags {
  readonly fix: boolean
  readonly json: boolean
  readonly linksOnly: boolean
  readonly prose: boolean
  readonly refs: boolean
  readonly stamp: boolean
  readonly summariesOnly: boolean
}

export interface CheckRunArgs {
  readonly base: string
  readonly cli: CheckCliFlags
  readonly ignore: readonly string[]
  readonly resolved: ResolvedConfig
  readonly roots: readonly string[]
  readonly trackedFiles?: ReadonlySet<string> | undefined
}

export interface FormatOptions {
  readonly locale: Locale
  /** Issue #162 item 1: threaded through so `refsPlugin.format` can read the
   * repo's actual configured ref-stamping command instead of hardcoding a
   * guess — the same pattern `CheckSummaries.ts`'s `formatSummaryReport`
   * already uses for `stampCommand`. Optional and unused by every other
   * plugin today; only `refs` reads it. */
  readonly refsStampCommand?: string
}

/** One check, decoupled from cli.ts's own dispatch: cli.ts only ever calls
 * `isEnabled`, `run`, `format`, `exitCode` (and, when present, `stamp`)
 * through this shape — it never again needs to know a specific check's own
 * config field name or CLI flag to decide whether to run it.
 *
 * Split into a non-generic `CheckPluginMeta` base: `isEnabled`/
 * `jsonUnsupportedMessage`/`name` don't mention `Result` at all, so a
 * consumer that only needs THOSE (e.g. `rejectedJsonMessage`'s upfront gate,
 * which must scan a heterogeneous list of differently-`Result`-typed
 * plugins together) can take `readonly CheckPluginMeta[]` instead of forcing
 * every plugin through a lossy `CheckPlugin<unknown>` cast — `Result`
 * appears in a contravariant (parameter) position in `exitCode`/`format`, so
 * `CheckPlugin<number>` is not actually a subtype of `CheckPlugin<unknown>`
 * under TypeScript's strict function-parameter variance. */
export interface CheckPluginMeta {
  readonly isEnabled: (resolved: ResolvedConfig, cli: CheckCliFlags) => boolean
  /** English-only, matching the existing `--json` rejection messages this
   * replaces (e.g. `"--json cannot be combined with --refs yet"`) — those
   * were never localized either; `--json` output itself is machine-
   * readable, so English-only here isn't a new inconsistency. Absent means
   * this plugin has no known incompatibility with `--json` today. */
  readonly jsonUnsupportedMessage?: string
  readonly name: string
}

// `Env` defaults to `DocsFs` — every plugin until now only ever needed it.
// `freshness` (`../structure/CheckFreshness.ts`) is the first that also
// needs live git data (`GitFs.lastCommitDate`), so it instantiates this
// with `CheckPlugin<FreshnessResult, DocsFs | GitFs>` instead. A SECOND type
// parameter, not just widening every plugin's `run` to `DocsFs | GitFs`
// unconditionally — tried first, and reverted: with a single fixed `Env`,
// every OTHER plugin's `run`, once annotated `: CheckPlugin<Result>`, is
// typed via the INTERFACE's declared environment, not its own narrower
// actual implementation — so every existing test that only provides
// `DocsFs` (via `Effect.provide(makeTestDocsFs(...))`) would stop
// satisfying `Effect.runPromise`'s `R = never` requirement, purely because
// of a plugin they never touch needing `GitFs`. Confirmed for real:
// `pnpm typecheck` broke in every sibling `*.plugin.unit.test.ts` file the
// first time this was tried with a fixed `DocsFs | GitFs` environment.
export interface CheckPlugin<Result, Env = DocsFs> extends CheckPluginMeta {
  readonly exitCode: (result: Result) => number
  readonly format: (result: Result, options: FormatOptions) => readonly string[]
  readonly run: (args: CheckRunArgs) => Effect.Effect<Result, never, Env>
  /** Only `refs` has one today (`--refs --stamp`). Returns pre-formatted
   * report lines directly (not a separate `Result` + `format` pair) — with
   * exactly one real consumer, a parallel `StampResult`/`formatStamp` pair
   * would be speculative generality with nothing to generalize over yet. */
  readonly stamp?: (args: CheckRunArgs) => Effect.Effect<readonly string[], never, Env>
}
