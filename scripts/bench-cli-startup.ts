// Times the actual built CLI's startup and appends a synthetic "benchmark"
// entry (matching vitest bench's --outputJson shape) to an existing report file,
// so it flows through the same scripts/bench-assert.ts comparison pipeline as
// the source-level micro-benchmarks in src/core/*.bench.ts.
//
// Closes a real gap in those: vitest bench transforms src/ on the fly via Vite's
// own esbuild pipeline — it never invokes `tsc -p tsconfig.build.json` or the
// `esbuild --bundle` step that produces the actual dist/cli.js shipped to users.
// A regression introduced by the BUILD TOOLCHAIN itself (a `typescript` or
// `esbuild` devDependency bump changing what gets emitted/bundled) would
// otherwise be invisible to the gate — confirmed directly: `bench` reported
// SUCCESS on a typescript 5.9.3->7.0.2 bump PR despite never exercising tsc.
// This also covers the CLI-bundling startup-time fix from this session (the
// ~4.5x win from bundling dist/cli.js), which previously had NO regression
// coverage at all.
//
// Requires `pnpm build` to have already produced dist/cli.js in the current
// working directory (the workflow/hook invoking this runs it after building).

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'

const RUNS = 10

interface VitestBenchReportShape {
  files: { filepath: string; groups: { benchmarks: { mean: number; name: string }[]; fullName: string }[] }[]
}

const timeCliStartup = (): number => {
  // One untimed warm-up run so filesystem/module caches are hot before measuring
  // — otherwise the FIRST invocation in a fresh checkout is dominated by disk I/O
  // noise unrelated to the code being compared.
  execFileSync('node', ['dist/cli.js', '--help'], { stdio: 'ignore' })
  const start = performance.now()
  for (let i = 0; i < RUNS; i++) {
    execFileSync('node', ['dist/cli.js', '--help'], { stdio: 'ignore' })
  }
  return (performance.now() - start) / RUNS
}

if (process.argv[1] === import.meta.filename) {
  const [reportPath] = process.argv.slice(2)
  if (reportPath === undefined) {
    throw new Error('usage: bench-cli-startup.ts <report.json>')
  }
  const mean = timeCliStartup()
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as VitestBenchReportShape
  report.files.push({
    filepath: 'dist/cli.js (synthetic: real built-artifact startup time)',
    groups: [{ benchmarks: [{ mean, name: `--help (${RUNS}-run mean)` }], fullName: 'cli-startup' }],
  })
  fs.writeFileSync(reportPath, JSON.stringify(report))
  console.log(`cli-startup: ${mean.toFixed(1)}ms mean over ${RUNS} runs`)
}
