// Times the actual built CLI's `check` command against a realistic, disposable
// fixture — not just `--help` (scripts/bench-cli-startup.ts), which only measures
// process/module-loading startup and never actually SCANS anything. Appends a
// synthetic "benchmark" entry (matching vitest bench's --outputJson shape) to an
// existing report file, same convention as bench-cli-startup.ts, so it flows
// through the same scripts/bench-assert.ts comparison pipeline.
//
// Closes a real gap: none of src/core/*.bench.ts or CheckSummaries.bench.ts
// exercise the CheckPlugin registry (src/program/checks/) at all — links, refs,
// proseRefs, and coverage all migrated onto it, but the only program-level
// benchmark that existed (CheckSummaries.bench.ts) is for the one check that
// stays OUTSIDE the registry entirely (see docs/adr/0003). A regression in the
// registry's own dispatch overhead (isEnabled -> run -> format -> exitCode, once
// per plugin, per `cairn check` invocation) would have been invisible to the
// existing bench suite no matter how large. This fixture enables `checks.coverage`
// specifically so the timed run actually exercises the registry-dispatched
// coverage plugin, not just links (also registry-dispatched) and summaries (not).
//
// Requires `pnpm build` to have already produced dist/cli.js in the current
// working directory (the workflow/hook invoking this runs it after building) —
// same precondition as bench-cli-startup.ts.
//
// This file is deliberately thin (argv parsing + orchestration only) — the
// actual subprocess-invocation and report-shaping logic lives in
// src/devTools/BenchCliCheck.ts, which (unlike this scripts/ entrypoint) has
// real unit + integration test coverage. Matches this repo's own
// "src/cli.ts stays thin, dogfooded via subprocess; the logic it wires
// together lives in tested src/ modules" convention.

import * as fs from 'node:fs'

import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'

import {
  appendSyntheticBenchEntry,
  buildCheckFixture,
  decodeReport,
  DECISION_COUNT,
  FEATURE_COUNT,
  runCliCheckOnce,
} from '../src/devTools/BenchCliCheck.ts'

const RUNS = 10

const timeCliCheck = (cliPath: string): Effect.Effect<number, unknown, NodeServices.NodeServices> =>
  Effect.acquireUseRelease(
    Effect.sync(() => buildCheckFixture()),
    (fixture) =>
      Effect.gen(function* () {
        // One untimed warm-up run so filesystem/module caches are hot before
        // measuring, same reasoning as bench-cli-startup.ts.
        yield* runCliCheckOnce(cliPath, fixture)
        const start = performance.now()
        for (let i = 0; i < RUNS; i++) {
          yield* runCliCheckOnce(cliPath, fixture)
        }
        return (performance.now() - start) / RUNS
      }),
    (fixture) => Effect.sync(() => fs.rmSync(fixture, { force: true, recursive: true })),
  )

if (process.argv[1] === import.meta.filename) {
  const [reportPath] = process.argv.slice(2)
  if (reportPath === undefined) {
    throw new Error('usage: bench-cli-check.ts <report.json>')
  }
  const mean = await Effect.runPromise(timeCliCheck('dist/cli.js').pipe(Effect.provide(NodeServices.layer)))
  const report = decodeReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')))
  const updated = appendSyntheticBenchEntry(report, {
    filepath: 'dist/cli.js (synthetic: real `check` run, links+summaries+coverage)',
    fullName: 'cli-check',
    mean,
    name: `check, ${FEATURE_COUNT + DECISION_COUNT} docs (${RUNS}-run mean)`,
  })
  fs.writeFileSync(reportPath, JSON.stringify(updated))
  console.log(`cli-check: ${mean.toFixed(1)}ms mean over ${RUNS} runs (${FEATURE_COUNT + DECISION_COUNT} docs)`)
}
