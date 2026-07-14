// Relative perf-regression gate: compares two `vitest bench --outputJson` reports
// (a "before" and an "after") and fails if any benchmark got meaningfully slower.
//
// Deliberately NOT a cross-run comparison against a stored historical baseline (that
// approach — a cache/gh-pages-backed tool like benchmark-action/github-action-benchmark
// — needs a very loose threshold, e.g. 200%, to survive GitHub's shared-runner timing
// variance across different jobs/days). Comparing "before" and "after" back-to-back on
// the SAME runner in the SAME job removes that cross-run noise, so a much tighter
// threshold is trustworthy here.
//
// Dual use: `pnpm run bench:assert -- <before.json> <after.json>` works identically
// whether "before"/"after" came from two branches checked out in CI, or two local runs
// a developer did by hand before pushing (the same discipline mostjs relies on humans
// for — this just makes it a single command instead of eyeballing numbers).

import * as fs from 'node:fs'

// `mean` is optional, not just theoretically: a benchmark whose function throws does
// NOT fail `vitest bench`'s process exit code — it exits 0 and simply omits `mean`
// (and `hz`, etc.) from that one entry. Confirmed directly: a benchmark that throws
// produces `{ "id": ..., "name": "boom", "rank": 1, "rme": 0, "samples": [] }`, no
// `mean` field at all. A naive `afterMean / beforeMean` would silently divide by/into
// `undefined`, produce `NaN`, and `NaN > threshold` is `false` in JS — treating the
// single worst possible outcome (a crash) as "not a regression." See `crashed` below.
interface VitestBenchmark {
  readonly mean?: number
  readonly name: string
}

interface VitestBenchGroup {
  readonly benchmarks: readonly VitestBenchmark[]
  readonly fullName: string
}

interface VitestBenchFile {
  readonly groups: readonly VitestBenchGroup[]
}

interface VitestBenchReport {
  readonly files: readonly VitestBenchFile[]
}

interface BenchEntry {
  readonly mean: number | undefined
  readonly name: string
}

interface Regression {
  readonly afterMean: number | undefined
  readonly beforeMean: number
  readonly crashed: boolean
  readonly name: string
  readonly ratio: number
}

export interface Comparison {
  /** How many benchmarks existed in each report, and how many could be matched by
   * name across both. A run that produces 0 `comparedCount` isn't "no regressions" —
   * it's a broken comparison (renamed benchmarks, wrong files, a matching bug) that
   * would otherwise report a silent, meaningless pass. That distinction is the whole
   * point of surfacing this: proof the gate actually executed, not just that it
   * didn't complain. */
  readonly afterCount: number
  readonly beforeCount: number
  readonly comparedCount: number
  readonly regressions: readonly Regression[]
}

const flatten = (report: VitestBenchReport): BenchEntry[] =>
  report.files.flatMap((file) =>
    file.groups.flatMap((group) =>
      group.benchmarks.map((benchmark) => ({
        mean: benchmark.mean,
        name: `${group.fullName} > ${benchmark.name}`,
      })),
    ),
  )

/** Compare two reports: benchmarks present in both whose `after` mean exceeds
 * `threshold` x its `before` mean, sorted worst-first (a crashed `after` — see the
 * module comment — always sorts first, ratio `Infinity`), plus counts proving the
 * comparison actually matched real benchmarks (see `Comparison.comparedCount`). A
 * benchmark missing from either side (renamed, added, removed), or whose `before`
 * itself has no valid mean, can't be compared and is skipped — this gate is about
 * regressions, not drift, and needs a real baseline to regress from. */
export const compareReports = (before: VitestBenchReport, after: VitestBenchReport, threshold: number): Comparison => {
  const beforeEntries = flatten(before)
  const afterEntries = flatten(after)
  const beforeByName = new Map(beforeEntries.map((entry) => [entry.name, entry.mean]))
  const regressions: Regression[] = []
  let comparedCount = 0
  for (const { mean: afterMean, name } of afterEntries) {
    const beforeMean = beforeByName.get(name)
    if (beforeMean === undefined || !Number.isFinite(beforeMean) || beforeMean <= 0) {
      continue
    }
    comparedCount += 1
    const crashed = afterMean === undefined || !Number.isFinite(afterMean)
    if (crashed) {
      regressions.push({ afterMean, beforeMean, crashed: true, name, ratio: Number.POSITIVE_INFINITY })
      continue
    }
    const ratio = afterMean / beforeMean
    if (ratio > threshold) {
      regressions.push({ afterMean, beforeMean, crashed: false, name, ratio })
    }
  }
  return {
    afterCount: afterEntries.length,
    beforeCount: beforeEntries.length,
    comparedCount,
    regressions: regressions.toSorted((a, b) => b.ratio - a.ratio),
  }
}

if (process.argv[1] === import.meta.filename) {
  const [beforePath, afterPath, thresholdArg] = process.argv.slice(2)
  if (beforePath === undefined || afterPath === undefined) {
    throw new Error('usage: bench-assert.ts <before.json> <after.json> [threshold=1.5]')
  }
  const threshold = thresholdArg === undefined ? 1.5 : Number(thresholdArg)
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8')) as VitestBenchReport
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8')) as VitestBenchReport
  const { afterCount, beforeCount, comparedCount, regressions } = compareReports(before, after, threshold)

  if (comparedCount === 0) {
    console.error(
      `bench-assert: 0 of ${beforeCount} before / ${afterCount} after benchmark(s) could be matched by name — ` +
        'the comparison is vacuous, not a genuine pass. Treating as a failure, not "no regressions".',
    )
    process.exitCode = 1
  } else {
    console.log(`bench-assert: compared ${comparedCount}/${afterCount} benchmark(s) (before had ${beforeCount}).`)
    if (comparedCount < afterCount * 0.5) {
      console.warn(
        `bench-assert: warning — only ${comparedCount}/${afterCount} benchmarks matched by name; ` +
          'the rest were renamed, added, or removed and were NOT checked for regressions.',
      )
    }
    if (regressions.length === 0) {
      console.log(`No benchmark regressed beyond ${threshold}x.`)
    } else {
      console.error(`${regressions.length} benchmark(s) regressed beyond ${threshold}x:\n`)
      for (const r of regressions) {
        console.error(
          r.crashed
            ? `  CRASHED  ${r.name}  (was ${r.beforeMean.toFixed(4)}ms, now throws/never completes)`
            : `  ${r.ratio.toFixed(2)}x  ${r.name}  (${r.beforeMean.toFixed(4)}ms -> ${(r.afterMean ?? 0).toFixed(4)}ms)`,
        )
      }
      process.exitCode = 1
    }
  }
}
