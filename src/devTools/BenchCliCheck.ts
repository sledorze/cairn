// Effect-based core for scripts/bench-cli-check.ts — kept in src/ (unlike the
// thin scripts/*.ts entrypoint) so it gets real unit + integration test
// coverage, matching this repo's own "thin argv-only entrypoint, tested logic
// lives in src/" convention (see src/cli.ts + the modules it wires together).
//
// Uses effect's own ChildProcess/ChildProcessSpawner (effect/unstable/process)
// to shell out, the same idiom src/io/Git.ts's `runGit` already establishes,
// rather than raw node:child_process — a typed PlatformError/exit-code
// contract instead of a callback, and (critically for this module) injectable
// via ChildProcessSpawner for tests instead of only exercisable by actually
// spawning a real `node` process.
//
// `buildCheckFixture` is likewise Effect-based (`FileSystem` service, matching
// `io/DocsFs.ts`'s/`config.ts`'s own convention) rather than raw `node:fs` —
// safe to do without perf concern, unlike the hot paths this benchmark
// harness actually TIMES: the caller (scripts/bench-cli-check.ts) builds the
// fixture entirely outside its own `performance.now()` window, so this
// module's own IO cost is never part of what's measured.

import * as path from 'node:path'

import { Data, Effect, FileSystem, Schema } from 'effect'
import type * as PlatformError from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

export const FEATURE_COUNT = 30
export const DECISION_COUNT = 10

// The subset of vitest's own --outputJson bench-report shape this module reads
// and writes — a real Schema (decoded via `decodeReport` below), not a bare
// `as` cast, so a malformed/renamed report file fails with a legible decode
// error instead of a silent `undefined` deep inside `appendSyntheticBenchEntry`.
const VitestBenchmarkSchema = Schema.Struct({ mean: Schema.Number, name: Schema.String })
const VitestBenchGroupSchema = Schema.Struct({
  benchmarks: Schema.Array(VitestBenchmarkSchema),
  fullName: Schema.String,
})
const VitestBenchFileSchema = Schema.Struct({ filepath: Schema.String, groups: Schema.Array(VitestBenchGroupSchema) })
export const VitestBenchReportSchema = Schema.Struct({ files: Schema.Array(VitestBenchFileSchema) })
export type VitestBenchReportShape = Schema.Schema.Type<typeof VitestBenchReportSchema>

/** Decodes a `JSON.parse`d, still-`unknown` value into a `VitestBenchReportShape`,
 * throwing a legible `Schema` decode error (not a raw `TypeError` three calls
 * later) if the report file doesn't actually match vitest bench's shape. */
export const decodeReport = (raw: unknown): VitestBenchReportShape =>
  Schema.decodeUnknownSync(VitestBenchReportSchema)(raw)

export class CliCheckFailedError extends Data.TaggedError('CliCheckFailedError')<{
  readonly exitCode: number
}> {}

/** A small but non-trivial doc tree: every feature doc links to a real decision
 * (cycling through all of them, so none are orphaned either) — a genuinely
 * CLEAN run (exit 0), the representative case most `cairn check` invocations
 * are, rather than one dominated by formatting a pile of findings. */
export const buildCheckFixture = (): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectory({ prefix: 'cairn-bench-check-' })
    yield* fs.makeDirectory(path.join(root, 'docs/adr'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'product/features'), { recursive: true })
    yield* fs.writeFileString(
      path.join(root, '.cairnrc.json'),
      JSON.stringify({
        checks: {
          coverage: {
            kinds: [
              {
                description: 'A product feature doc, for benchmarking.',
                id: 'feature',
                select: { by: 'path', glob: '**/product/features/**' },
              },
              {
                description: 'A decision record doc, for benchmarking.',
                id: 'decision',
                select: { by: 'path', glob: '**/docs/adr/**' },
              },
            ],
            rules: [{ from: 'feature', to: 'decision' }],
          },
        },
        requireDirSummaries: false,
        roots: ['docs', 'product'],
      }),
    )
    for (let i = 0; i < DECISION_COUNT; i++) {
      yield* fs.writeFileString(
        path.join(root, `docs/adr/${i}.md`),
        `# Decision ${i}\n\nBody text for decision ${i}.\n`,
      )
    }
    for (let i = 0; i < FEATURE_COUNT; i++) {
      const body = `See [decision](../../docs/adr/${i % DECISION_COUNT}.md) for background.`
      yield* fs.writeFileString(path.join(root, `product/features/${i}.md`), `# Feature ${i}\n\n${body}\n`)
    }
    return root
  })

/**
 * Runs `node <cliPath> check` in `cwd` and fails on a non-zero exit.
 *
 * `cliPath` is resolved to an absolute path BEFORE spawning — a real, found-
 * by-dogfooding bug: the child process's cwd is `cwd` (the fixture
 * directory), not the caller's own `process.cwd()`, so a relative `cliPath`
 * (e.g. the default `'dist/cli.js'` a caller passes) would resolve against
 * the fixture instead of the repo and fail with MODULE_NOT_FOUND the moment
 * the fixture isn't also the repo root — confirmed by hand before this fix
 * existed. `resolveAbsoluteCliPath`'s own unit test, plus the integration
 * test below (a relative path resolved from a DIFFERENT cwd than the spawned
 * child's), are this bug's regression coverage.
 */
export const resolveAbsoluteCliPath = (cliPath: string): string => path.resolve(cliPath)

export const runCliCheckOnce = (
  cliPath: string,
  cwd: string,
): Effect.Effect<void, CliCheckFailedError | PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const command = ChildProcess.make('node', [resolveAbsoluteCliPath(cliPath), 'check'], { cwd })
      const handle = yield* spawner.spawn(command)
      const exitCode = yield* handle.exitCode
      if (Number(exitCode) !== 0) {
        return yield* Effect.fail(new CliCheckFailedError({ exitCode: Number(exitCode) }))
      }
    }),
  )

/** Pure: appends a synthetic vitest-bench-shaped entry to an existing report,
 * the convention scripts/bench-cli-startup.ts also uses so both flow through
 * scripts/bench-assert.ts's comparison unmodified. Returns a new object
 * rather than mutating `report` in place. */
export const appendSyntheticBenchEntry = (
  report: VitestBenchReportShape,
  entry: { readonly filepath: string; readonly fullName: string; readonly name: string; readonly mean: number },
): VitestBenchReportShape => ({
  files: [
    ...report.files,
    {
      filepath: entry.filepath,
      groups: [{ benchmarks: [{ mean: entry.mean, name: entry.name }], fullName: entry.fullName }],
    },
  ],
})
