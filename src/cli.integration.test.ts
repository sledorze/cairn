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
// two most fragile, most likely-to-silently-regress behaviors the
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
import * as fs from 'node:fs'
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

// DX finding (goal: "refute the DX for end users (dev/ai) is great"): a repo
// where NO roots resolve at all — the default `docs/` doesn't exist, nothing
// configured yet — used to print one warning line, then two green
// checkmarks, and exit 0: indistinguishable from genuine success by exit
// code alone (the one thing CI/automation actually checks). A tool whose
// entire purpose is enforcing doc rigor should fail loudly on a config that
// resolved to checking literally nothing, not report green.
describe('cli.ts (real subprocess) — zero resolved roots fails loudly', () => {
  it('exits 1 (not 0) when no configured root resolves to anything on disk', () => {
    const p = project('cli-zero-roots')
    const result = runCli(p.root, ['check'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('No documentation roots found')
  })

  it('exits 1 under --json too, even though the human-readable warning is suppressed there', () => {
    const p = project('cli-zero-roots-json')
    const result = runCli(p.root, ['check', '--json'])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).exitCode).toBe(1)
  })

  it('still exits 0 when at least one configured root resolves to real docs', () => {
    const p = project('cli-nonzero-roots', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/index.md': '# Index\n\nShort.\n',
    })
    const result = runCli(p.root, ['check', '--summaries-only'])
    expect(result.exitCode).toBe(0)
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

// Goal: "refute we don't have a mechanism to prove all feats are tested." Audited
// which cli.ts FLAGS were ever exercised by their literal `--name` syntax anywhere
// in the test suite (not just their underlying program-level function, which is a
// different, weaker claim — a flag can be wired to a well-tested function with the
// wiring itself, the argv parsing -> correct call, never verified). Found 7 real
// gaps: --prune, --explain, --links-only, --config, --threshold, --locale, --root
// had ZERO test evidence at the CLI-flag level. This section is the fix, in two
// parts: a self-enforcing completeness guard (below) so a FUTURE flag added to
// cli.ts without a matching test fails CI instead of silently joining the same
// gap, plus one real smoke test per flag that was actually missing.
describe('cli.ts (real subprocess) — every documented flag is exercised by name', () => {
  /** Parses one `--help` output's own FLAGS section (not GLOBAL FLAGS — those are
   * framework-provided, not app logic) into the flag names it documents. */
  const extractDocumentedFlags = (helpOutput: string): string[] => {
    const flagsSection = helpOutput.split(/^GLOBAL FLAGS$/m)[0] ?? helpOutput
    return [...flagsSection.matchAll(/^ {2}(--[a-z][a-z-]*)\b/gm)].map((m) => m[1] as string)
  }

  it('sanity: --help really does document more than a couple of flags today', () => {
    const p = project('cli-flags-sanity')
    const flags = extractDocumentedFlags(runCli(p.root, ['check', '--help']).stdout)
    expect(flags.length).toBeGreaterThan(5)
  })

  it('every flag documented by `check --help`, `config --help`, and `init --help` appears literally in this file', () => {
    const p = project('cli-flags-completeness')
    const documented = new Set([
      ...extractDocumentedFlags(runCli(p.root, ['check', '--help']).stdout),
      ...extractDocumentedFlags(runCli(p.root, ['config', '--help']).stdout),
      ...extractDocumentedFlags(runCli(p.root, ['init', '--help']).stdout),
    ])
    const ownSource = fs.readFileSync(import.meta.filename, 'utf8')
    const undocumented = [...documented].filter((flag) => !ownSource.includes(`'${flag}'`))
    expect(undocumented).toEqual([])
  })
})

describe('cli.ts (real subprocess) — flags with no prior CLI-level test coverage', () => {
  it('--links-only skips the summaries check entirely, not just its findings', () => {
    const p = project('cli-links-only', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      // Long enough to need a summary (default threshold 30 lines) — proves
      // --links-only doesn't just hide a passing summaries line, it never runs
      // that check at all.
      'docs/a.md': `# A\n\n${'line\n'.repeat(40)}`,
    })
    const result = runCli(p.root, ['check', '--links-only'])
    expect(result.stdout).not.toContain('summar')
    expect(result.exitCode).toBe(0)
  })

  it('--explain adds the expected/recorded hash breakdown that a plain run omits', () => {
    const p = project('cli-explain', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/a.md': `# A\n\n${'line\n'.repeat(40)}`,
    })
    const plain = runCli(p.root, ['check', '--summaries-only'])
    const explained = runCli(p.root, ['check', '--summaries-only', '--explain'])
    expect(plain.stdout).not.toContain('expected')
    expect(explained.stdout).toContain('expected')
    expect(explained.stdout).toContain('recorded')
  })

  it('--prune deletes a real orphan summary (source doc gone) from disk', () => {
    const p = project('cli-prune', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      // `a.summary.md` with no matching `a.md` — a genuine orphan, not a stub.
      'docs/a.summary.md': '# A — summary\n\nStale summary for a deleted source doc.\n',
    })
    expect(fs.existsSync(path.join(p.root, 'docs/a.summary.md'))).toBeTruthy()
    const result = runCli(p.root, ['check', '--prune'])
    expect(result.stdout).toContain('removed 1 orphan summary')
    expect(fs.existsSync(path.join(p.root, 'docs/a.summary.md'))).toBeFalsy()
  })

  it('--config points at an explicit config file instead of the default lookup', () => {
    const p = project('cli-config-flag', {
      'custom.json': JSON.stringify({ requireDirSummaries: false, roots: ['elsewhere'] }),
      'elsewhere/a.md': '# A\n\nShort.\n',
    })
    const result = runCli(p.root, ['config', '--config', 'custom.json'])
    expect(result.stdout).toContain('custom.json')
    expect(result.stdout).toContain('"roots": [\n    "elsewhere"\n  ]')
  })

  it('--threshold overrides the line count above which a doc needs a summary', () => {
    const p = project('cli-threshold', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      // 10 real lines of body.
      'docs/a.md': `# A\n\n${'line\n'.repeat(10)}`,
    })
    const belowThreshold = runCli(p.root, ['check', '--summaries-only', '--threshold', '50'])
    const aboveThreshold = runCli(p.root, ['check', '--summaries-only', '--threshold', '5'])
    expect(belowThreshold.exitCode).toBe(0)
    expect(aboveThreshold.exitCode).toBe(1)
  })

  it('--locale fr switches real report output to French, not just a config field', () => {
    const p = project('cli-locale', { 'docs/a.md': '[broken](./nope.md)\n' })
    const result = runCli(p.root, ['check', '--locale', 'fr'])
    expect(result.stdout).toContain('lien(s) mort(s)')
  })

  it('--root adds a directory to scan, merged with (not replacing) any configured roots', () => {
    const p = project('cli-root-flag', {
      // No .cairnrc.json at all — proves the extra root isn't coming from config.
      'extra-docs/a.md': '[broken](./nope.md)\n',
    })
    const result = runCli(p.root, ['check', '--root', 'extra-docs'])
    expect(result.stdout).toContain('dead link')
    expect(result.exitCode).toBe(1)
  })

  it('--fix rewrites a real unambiguous renamed-file link on disk', () => {
    const p = project('cli-fix', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/index.md': '# Doc\n\n- [x](./old-name.md)\n',
      'docs/sub/old-name.md': '# Renamed target\n',
    })
    const result = runCli(p.root, ['check', '--fix'])
    expect(result.stdout).toContain('Auto-repaired 1 link')
    expect(fs.readFileSync(path.join(p.root, 'docs/index.md'), 'utf8')).toContain('[x](./sub/old-name.md)')
  })

  it('--migrate-stamps strips the legacy in-content stamp AND writes the .cairn/** sidecar', () => {
    const legacyStamp = `<!-- source-sha256: ${'0'.repeat(64)} -->\n\n`
    const p = project('cli-migrate-stamps', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/a.md': `# A\n\n${'line\n'.repeat(40)}`,
      'docs/a.summary.md': `${legacyStamp}# A — summary\n`,
    })
    const result = runCli(p.root, ['check', '--migrate-stamps'])
    expect(result.stdout).toContain('Migrated 1 legacy in-content stamp')
    expect(fs.readFileSync(path.join(p.root, 'docs/a.summary.md'), 'utf8')).not.toContain('source-sha256')
    expect(fs.existsSync(path.join(p.root, '.cairn/docs/a.summary.md.json'))).toBeTruthy()
  })

  it('init --agent claude scaffolds CLAUDE.md with an @AGENTS.md import', () => {
    const p = project('cli-init-agent')
    const result = runCli(p.root, ['init', '--agent', 'claude'])
    expect(result.exitCode).toBe(0)
    expect(fs.existsSync(path.join(p.root, 'AGENTS.md'))).toBeTruthy()
    expect(fs.readFileSync(path.join(p.root, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md')
  })
})
