// A real-subprocess integration test for cli.ts — the one file this repo's
// own convention (docs/architecture.md) deliberately excludes from unit
// testing/coverage, "dogfooded via real subprocess" instead. That
// convention was, until now, entirely manual: every cli.ts behavior claim
// (docs/adr/0003's "manually checked against the pre-refactor binary across
// every flag combination") was checked once at a terminal and never
// converted into a permanent regression check — exactly the "a bug you
// found by hand and fixed, with no test added, is a bug that can silently
// come back" gap this repo's own docs-summaries.md convention warns about
// for a different case. This file doesn't attempt exhaustive coverage of
// cli.ts (that's still real subprocess dogfooding's job) — it locks in the
// three most fragile, most likely-to-silently-regress behaviors the
// check-plugin-registry refactor (docs/adr/0003) touches directly: the
// `--json` incompatibility gate and its ordering (all 3 plugins that
// declare one), and the `--refs --stamp` + summaries `--stamp`
// co-occurrence (two independent stamp operations that must both fire from
// a single flag, in a fixed order).
//
// Runs `node_modules/.bin/tsx` directly, not `npx tsx` — `npx` adds its own
// resolve-and-delegate step on top of `tsx`'s already-real transpile cost;
// the local binary is guaranteed present (a devDependency) and one hop
// closer to what actually executes. Not `node dist/cli.js` against the
// built binary either: `pnpm verify`'s own order is
// `lint && typecheck && test && build && check` — `test` runs BEFORE
// `build`, so `dist/cli.js` isn't guaranteed to exist yet when this file
// runs, the same reason `package.json`'s own `check` script
// (`tsx src/cli.ts check`) runs against source, not the built artifact.

import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { TempProject } from './testSupport/tempProject.ts'
import { makeTempProject } from './testSupport/tempProject.ts'

const CLI = path.join(import.meta.dirname, 'cli.ts')
const TSX = path.join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx')

const projects: TempProject[] = []
const project = (prefix: string, files: Record<string, string> = {}): TempProject => {
  const p = makeTempProject(prefix, files)
  projects.push(p)
  return p
}
afterEach(() => {
  while (projects.length > 0) {
    projects.pop()?.dispose()
  }
})

/** Runs the real CLI as a subprocess, `cwd`'d at `root` — never throws on a
 * non-zero exit (matching `execFileSync`'s own throw-on-nonzero behavior
 * would make asserting exit codes awkward), returns stdout + the real exit
 * code together. Distinguishes the CLI itself exiting non-zero (real
 * `stdout`, a real `status`) from the subprocess failing to even LAUNCH
 * (e.g. a missing/non-executable `tsx` binary in a broken environment —
 * `status: null`, `stdout: null`, an `error.code` like `ENOENT` instead) —
 * the latter throws here with a clear, named message instead of silently
 * returning `stdout: undefined` for a caller's `JSON.parse`/`.indexOf` to
 * fail on with an opaque, unrelated-looking error. */
const runCli = (root: string, args: readonly string[]): { readonly exitCode: number; readonly stdout: string } => {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], { cwd: root, encoding: 'utf8' })
    return { exitCode: 0, stdout }
  } catch (error) {
    const e = error as { code?: string; status: number | null; stdout: string | null }
    if (e.status === null) {
      throw new Error(`runCli: subprocess failed to launch (${TSX}): ${e.code ?? String(error)}`, { cause: error })
    }
    return { exitCode: e.status, stdout: e.stdout ?? '' }
  }
}

describe('cli.ts (real subprocess) — --json incompatibility gate', () => {
  it('rejects --json --refs with the exact prior message, before running anything', () => {
    const p = project('cli-json-refs', { 'docs/index.md': '# Index\n\nShort.\n' })
    const result = runCli(p.root, ['check', '--json', '--refs'])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({ error: '--json cannot be combined with --refs yet' })
  })

  it('rejects --json --prose-refs with the exact prior message', () => {
    const p = project('cli-json-prose', { 'docs/index.md': '# Index\n\nShort.\n' })
    const result = runCli(p.root, ['check', '--json', '--prose-refs'])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({ error: '--json cannot be combined with --prose-refs yet' })
  })

  it('rejects --json when checks.coverage is configured, even without any coverage-specific flag', () => {
    const p = project('cli-json-coverage', {
      '.cairnrc.json': JSON.stringify({ checks: { coverage: { kinds: [], rules: [] } } }),
      'docs/index.md': '# Index\n\nShort.\n',
    })
    const result = runCli(p.root, ['check', '--json'])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({ error: '--json cannot be combined with checks.coverage yet' })
  })

  // Precedence: refs is checked before proseRefs before coverage
  // (JSON_INCOMPATIBLE_PLUGINS' declared order in cli.ts) — with all three
  // simultaneously applicable, refs' message must win.
  it('reports the FIRST applicable rejection (refs) when --refs, --prose-refs, and checks.coverage all apply at once', () => {
    const p = project('cli-json-precedence', {
      '.cairnrc.json': JSON.stringify({ checks: { coverage: { kinds: [], rules: [] } } }),
      'docs/index.md': '# Index\n\nShort.\n',
    })
    const result = runCli(p.root, ['check', '--json', '--refs', '--prose-refs'])
    expect(JSON.parse(result.stdout)).toEqual({ error: '--json cannot be combined with --refs yet' })
  })
})

describe("cli.ts (real subprocess) — --refs --stamp co-occurs with summaries' own --stamp", () => {
  it('stamps BOTH refs and summaries from a single --refs --stamp invocation, summaries first', () => {
    const p = project('cli-refs-stamp', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/a.md': '# A\n\n[b](./b.md)\n',
      'docs/b.md': '# B\n',
    })
    const result = runCli(p.root, ['check', '--refs', '--stamp'])
    const summariesLine = result.stdout.indexOf('Stamped 0 summary')
    const refsLine = result.stdout.indexOf("Stamped 1 doc(s)' reference hash")
    expect(summariesLine).toBeGreaterThanOrEqual(0)
    expect(refsLine).toBeGreaterThan(summariesLine)
  })
})
