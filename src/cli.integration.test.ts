// A real-subprocess integration test for cli.ts — the one file this repo's
// own convention (docs/architecture.md) deliberately excludes from unit
// testing/coverage, "dogfooded via real subprocess" instead. That
// convention was, until now, entirely manual: every cli.ts behavior claim
// (docs/adr/0003's "manually checked against the pre-refactor binary across
// every flag combination") was checked once at a terminal and never
// converted into a permanent regression check — exactly the "a bug you
// found by hand and fixed, with no test added, is a bug that can silently
// come back" gap this repo's own docs-summaries.md convention warns about
// for a different case. Two describe blocks are the deepest, most
// fragile-by-design behaviors the check-plugin-registry refactor
// (docs/adr/0003) touches directly: the `--json` incompatibility gate and
// its ordering (all 3 plugins that declare one), and the `--refs --stamp` +
// summaries `--stamp` co-occurrence (two independent stamp operations that
// must both fire from a single flag, in a fixed order).
//
// This file does NOT attempt exhaustive coverage of every flag
// COMBINATION or edge case — that's still real subprocess dogfooding's
// job. What it does guarantee, self-enforced by its own "every documented
// flag is exercised by name" test: every flag `--help` documents has AT
// LEAST ONE real-subprocess test proving its argv-to-behavior wiring
// actually works, not just that the function it calls has a test
// somewhere else. A flag added to cli.ts with no matching test here now
// fails CI instead of silently joining the same gap (found the hard way:
// audited this file against `--help`'s own flag list and found 10 flags,
// including `--fix` and `--migrate-stamps` — both with solid
// program-level test coverage — that had never once been exercised
// through the actual CLI).
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
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { TempProject } from './testSupport/tempProject.ts'
import { makeTempProject } from './testSupport/tempProject.ts'
import { runGit } from './testSupport/testGit.ts'

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
 * would make asserting exit codes awkward), returns stdout + stderr + the
 * real exit code together (`stderr` is where `CairnConfigError`'s own
 * `Console.error` writes — most callers only need `stdout`, so this stays
 * `''` on the success path rather than paying for a stderr capture nobody
 * reads there). Distinguishes the CLI itself exiting non-zero (real
 * `stdout`, a real `status`) from the subprocess failing to even LAUNCH
 * (e.g. a missing/non-executable `tsx` binary in a broken environment —
 * `status: null`, `stdout: null`, an `error.code` like `ENOENT` instead) —
 * the latter throws here with a clear, named message instead of silently
 * returning `stdout: undefined` for a caller's `JSON.parse`/`.indexOf` to
 * fail on with an opaque, unrelated-looking error. */
const runCli = (
  root: string,
  args: readonly string[],
): { readonly exitCode: number; readonly stderr: string; readonly stdout: string } => {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], { cwd: root, encoding: 'utf8' })
    return { exitCode: 0, stderr: '', stdout }
  } catch (error) {
    const e = error as { code?: string; status: number | null; stderr: string | null; stdout: string | null }
    if (e.status === null) {
      throw new Error(`runCli: subprocess failed to launch (${TSX}): ${e.code ?? String(error)}`, { cause: error })
    }
    return { exitCode: e.status, stderr: e.stderr ?? '', stdout: e.stdout ?? '' }
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

  // Issue #106: --report-deletions isn't part of the CheckPlugin registry
  // (it needs live GitFs, which the registry deliberately keeps out), so
  // its --json guard is a hand-written `if`, not the generic
  // `rejectedJsonMessage` mechanism the three tests above share — this is
  // its own, previously-untested code path (the only prior verification
  // was a human/agent reading cli.ts, never actually executed).
  it('rejects --json --report-deletions with a clear message, before running anything', () => {
    const p = project('cli-json-report-deletions', { 'docs/index.md': '# Index\n\nShort.\n' })
    const result = runCli(p.root, ['check', '--json', '--report-deletions'])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({ error: '--json cannot be combined with --report-deletions' })
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

// --changed (spike): scopes checks.coverage's report to rule edges touching
// the given path(s), printing each matching rule's own `description` as
// AI-review guidance — instead of the full missing/orphan corpus report.
describe('cli.ts (real subprocess) — --changed scopes checks.coverage to AI-review guidance', () => {
  const changedProject = () =>
    project('cli-changed', {
      '.cairnrc.json': JSON.stringify({
        checks: {
          coverage: {
            kinds: [
              { description: 'A feature doc.', id: 'feature', select: { by: 'path', glob: '**/docs/features/**' } },
              { description: 'A decision doc.', id: 'decision', select: { by: 'path', glob: '**/docs/decisions/**' } },
            ],
            rules: [
              {
                description: 'A feature changing its contract must keep its linked decision doc in sync.',
                from: 'feature',
                to: 'decision',
              },
            ],
          },
          summaries: false,
        },
      }),
      'docs/decisions/d1.md': '# Decision 1\n',
      'docs/features/f1.md': '# Feature 1\n\nSee [decision](../decisions/d1.md).\n',
      // Also satisfies the rule (unlike f1, via its own separate link) so
      // the UNSCOPED baseline report is green — this describe block is
      // about `--changed` SCOPING an already-satisfied corpus, not about
      // triggering `missing`, which the pre-existing coverage tests already
      // cover on their own.
      'docs/features/f2.md': '# Feature 2\n\nSee [decision](../decisions/d1.md).\n',
      // Classified as neither kind — the "no rule touches this changed
      // path" case below.
      'docs/other.md': '# Unrelated doc, not feature- or decision-kind\n',
    })

  it("prints the rule's description for a changed doc that IS a rule's `from` side", () => {
    const p = changedProject()
    const result = runCli(p.root, ['check', '--changed', 'docs/features/f1.md'])
    expect(result.stdout).toContain('docs/features/f1.md')
    expect(result.stdout).toContain('A feature changing its contract must keep its linked decision doc in sync.')
    // f2 never changed, so its own (unrelated) edge must not appear.
    expect(result.stdout).not.toContain('docs/features/f2.md')
  })

  it("also matches when the changed doc is a rule's `satisfiedBy` TARGET, not its `from` side", () => {
    const p = changedProject()
    const result = runCli(p.root, ['check', '--changed', 'docs/decisions/d1.md'])
    // d1 is the satisfying target for BOTH f1 and f2's edges.
    expect(result.stdout).toContain('docs/features/f1.md')
    expect(result.stdout).toContain('docs/features/f2.md')
    expect(result.stdout).toContain('A feature changing its contract must keep its linked decision doc in sync.')
  })

  it('reports "no rule touches this" for a changed path matching no rule edge at all', () => {
    const p = changedProject()
    const result = runCli(p.root, ['check', '--changed', 'docs/other.md'])
    expect(result.stdout).toContain('No coverage rule touches the changed path')
  })

  it('leaves the ordinary (unscoped) report completely unaffected when --changed is not passed', () => {
    const p = changedProject()
    const result = runCli(p.root, ['check'])
    expect(result.stdout).toContain('Coverage OK')
    expect(result.stdout).not.toContain('A feature changing its contract must keep its linked decision doc in sync.')
  })

  // Adversarial-review finding: exit code 1 with a scoped report showing
  // only a clean edge (nothing visibly wrong) used to be unexplainable —
  // real repro: a compliant, CHANGED doc alongside a non-compliant,
  // UNTOUCHED one. Fixed by keeping the exit code corpus-wide (never
  // narrowed by --changed — see coverageExitCode's own doc comment) while
  // making the scoped report itself disclose the count of issues it isn't
  // showing.
  it('a scoped report showing only a clean edge still exits 1 AND explains why, when an untouched doc is broken', () => {
    const p = project('cli-changed-exit-code-repro', {
      '.cairnrc.json': JSON.stringify({
        checks: {
          coverage: {
            kinds: [
              { description: 'A feature doc.', id: 'feature', select: { by: 'path', glob: '**/docs/features/**' } },
              { description: 'A decision doc.', id: 'decision', select: { by: 'path', glob: '**/docs/decisions/**' } },
            ],
            rules: [{ description: 'Link every feature to its decision.', from: 'feature', to: 'decision' }],
          },
          summaries: false,
        },
      }),
      'docs/decisions/d1.md': '# Decision 1\n',
      // Changed + compliant: this is the ONLY thing the scoped report shows.
      'docs/features/f1.md': '# Feature 1\n\nSee [decision](../decisions/d1.md).\n',
      // Untouched + non-compliant: the real, sole cause of exit code 1 —
      // must stay invisible in the scoped report's edge list, but its
      // EXISTENCE must still be disclosed.
      'docs/features/f2.md': '# Feature 2, no link at all\n',
    })
    const result = runCli(p.root, ['check', '--changed', 'docs/features/f1.md'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('docs/features/f1.md')
    expect(result.stdout).not.toContain('docs/features/f2.md')
    expect(result.stdout).toContain('1 other coverage issue(s) not shown above')
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

// Issue #92: a `..`-free, non-absolute root pattern resolving to a symlink
// escaping `cwd` must fail loudly with a clean, one-line message and exit
// 1 — never a raw stack trace (the whole reason `expandRootsOrFail` lifts
// `expandRoots`'s thrown Error into the same `CairnConfigError` channel
// `loadConfigOrFail` already uses), and never a silent `0 checked` pass
// (which the "zero resolved roots fails loudly" tests above already prove
// exits 1 anyway — this is about the ERROR being informative, not just
// non-zero).
describe('cli.ts (real subprocess) — a root escaping cwd via a symlink fails loudly, not a stack trace', () => {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const supportsSymlinks = process.platform !== 'win32' && !isRoot

  it.skipIf(!supportsSymlinks)(
    'exits 1 with a clean, one-line message naming the symlink, not a raw stack trace',
    () => {
      const p = project('cli-root-escape')
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-root-escape-outside-'))
      try {
        fs.writeFileSync(path.join(outside, 'secret.md'), '# secret')
        fs.symlinkSync(outside, path.join(p.root, 'docs'), 'dir')
        const result = runCli(p.root, ['check'])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('cairn: root "docs" resolves to')
        expect(result.stderr).toContain('symlink')
        // Never a raw stack trace — the message is the whole story, same
        // "errorReported = false" discipline every other CairnConfigError
        // already gets.
        expect(result.stderr).not.toContain('at Object.<anonymous>')
        expect(result.stderr).not.toContain('.ts:')
      } finally {
        fs.rmSync(outside, { force: true, recursive: true })
      }
    },
  )

  it('a legitimate sibling-root config (`..`-relative, outside cwd) still succeeds — no false positive', () => {
    const p = project('cli-root-sibling-consumer')
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-root-sibling-docs-'))
    try {
      fs.writeFileSync(path.join(sibling, 'big.md'), Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'))
      const relative = path.relative(p.root, sibling)
      fs.writeFileSync(
        path.join(p.root, '.cairnrc.json'),
        JSON.stringify({ checks: { summaries: false }, roots: [relative] }),
      )
      const result = runCli(p.root, ['check'])
      // Real problem correctly found (no summary requirement, but the
      // sibling root itself was genuinely scanned, not silently dropped
      // the way PR #91's reverted attempt would have) — links-only report
      // stays green since there are no links to check.
      expect(result.exitCode).toBe(0)
    } finally {
      fs.rmSync(sibling, { force: true, recursive: true })
    }
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

  // Issue #104: `checks.coverage` has no CLI flag of its own (config-only
  // opt-in), so nothing in the FLAGS audit above could ever catch it —
  // before this fix, `cairn check --help | grep -c coverage` and
  // `cairn --help | grep -c coverage` both returned 0, the exact repro from
  // the issue. Config-only checks with no flag still need to be mentioned
  // in prose somewhere `--help` shows, or they're undiscoverable short of
  // reading the schema or vendored docs.
  it('mentions checks.coverage in --help even though it has no flag of its own (issue #104)', () => {
    const p = project('cli-coverage-discoverable')
    expect(runCli(p.root, ['check', '--help']).stdout).toContain('checks.coverage')
    expect(runCli(p.root, ['--help']).stdout).toContain('checks.coverage')
  })

  // Issue #105: --prose-refs's help text used to call it a "migration aid,"
  // discouraging exactly the permanent/ongoing use it was actually safe for
  // (always silent unless a citation genuinely drifted). Pins the wording
  // fix so it can't silently regress back to that framing.
  it('documents --prose-refs as safe for permanent use, not a one-time migration aid (issue #105)', () => {
    const p = project('cli-prose-refs-wording')
    const helpText = runCli(p.root, ['check', '--help']).stdout
    expect(helpText).toContain('--prose-refs')
    expect(helpText.toLowerCase()).not.toContain('migration aid')
  })

  // REX feedback: a doc documenting a path FORMAT (e.g. a sample-path table)
  // has real, path-shaped, never-real backticked text `--prose-refs` can't
  // tell apart from a genuine citation on its own. `checks.proseRefs.ignore`
  // is the config-level exemption — proven here through the REAL CLI +ᅟa
  // real config file, not just the program-level unit test, since the
  // config->plugin wiring itself (core/Config.ts's `layerConfig` ->
  // `resolved.checks.proseRefs.ignore` -> `CheckProseRefs.ts`'s plugin
  // `run`) is exactly what could silently break without this.
  it('checks.proseRefs.ignore (config) exempts an illustrative citation the CLI would otherwise report', () => {
    const withoutIgnore = project('cli-prose-refs-ignore-absent', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/guide.md': '| `src/a.ts` | silent |\n',
      // `src/` must be a REAL top-level entry — resolveOne's false-positive
      // guard silently skips any candidate whose first path segment doesn't
      // resolve, which would make this assertion pass for the wrong reason
      // (skipped, not reported-then-ignored) without a real `src/`.
      'src/other.ts': 'export {}\n',
    })
    const reported = runCli(withoutIgnore.root, ['check', '--prose-refs'])
    expect(reported.exitCode).toBe(1)
    expect(reported.stdout).toContain('src/a.ts')

    const withIgnore = project('cli-prose-refs-ignore-present', {
      '.cairnrc.json': JSON.stringify({
        checks: { proseRefs: { ignore: ['src/a.ts'] } },
        requireDirSummaries: false,
      }),
      'docs/guide.md': '| `src/a.ts` | silent |\n',
      'src/other.ts': 'export {}\n',
    })
    const exempted = runCli(withIgnore.root, ['check', '--prose-refs'])
    expect(exempted.exitCode).toBe(0)
    expect(exempted.stdout).not.toContain('src/a.ts')
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

  it('a plain failing run points at --explain; --explain itself does not repeat the hint', () => {
    const p = project('cli-explain-hint', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/a.md': `# A\n\n${'line\n'.repeat(40)}`,
    })
    const plain = runCli(p.root, ['check', '--summaries-only'])
    const explained = runCli(p.root, ['check', '--summaries-only', '--explain'])
    expect(plain.stdout).toContain('--explain')
    expect(explained.stdout).not.toMatch(/Tip:.*--explain|Astuce.*--explain/)
  })

  it('a clean summaries run never shows the --explain hint', () => {
    const p = project('cli-explain-hint-clean', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/a.md': '# A\n\nShort doc, under the threshold.\n',
    })
    const result = runCli(p.root, ['check', '--summaries-only'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('--explain')
  })

  it('an orphans-only failure (nothing in todo) never shows the --explain hint', () => {
    const p = project('cli-explain-hint-orphans-only', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      // `a.summary.md` with no matching `a.md` — orphan, no `todo` entries.
      'docs/a.summary.md': '# A — summary\n\nStale summary for a deleted source doc.\n',
    })
    const result = runCli(p.root, ['check', '--summaries-only'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('orphan')
    expect(result.stdout).not.toContain('--explain')
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

  // Issue #106: --report-deletions needs a REAL git repo (it compares the
  // working tree against a ref) — `project()`'s temp dir isn't one on its
  // own, so this git-inits it directly, matching Git.integration.test.ts's
  // own real-git fixture convention.
  it("--report-deletions reports a deleted doc's orphaned heading, and never affects the exit code", () => {
    const p = project('cli-report-deletions', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/kept.md': '# Kept\n\nUnrelated content.\n',
      'docs/old.md': '# Old\n\n### Unique Section\n\nOnly description of this feature anywhere.\n',
    })
    runGit(p.root, 'init', '-q')
    runGit(p.root, 'config', 'user.email', 'test@example.com')
    runGit(p.root, 'config', 'user.name', 'Test')
    runGit(p.root, 'add', '.')
    runGit(p.root, 'commit', '-q', '-m', 'initial')
    fs.rmSync(path.join(p.root, 'docs/old.md'))

    const result = runCli(p.root, ['check', '--report-deletions', '--links-only'])
    expect(result.stdout).toContain('docs/old.md')
    expect(result.stdout).toContain('### Unique Section')
    expect(result.exitCode).toBe(0)
  })

  it('--deletions-since compares against an explicit ref, catching an already-committed deletion', () => {
    const p = project('cli-deletions-since', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/old.md': '# Old\n\n### Unique Section\n\nOnly description of this feature anywhere.\n',
    })
    runGit(p.root, 'init', '-q')
    runGit(p.root, 'config', 'user.email', 'test@example.com')
    runGit(p.root, 'config', 'user.name', 'Test')
    runGit(p.root, 'add', '.')
    runGit(p.root, 'commit', '-q', '-m', 'initial')
    const baseSha = runGit(p.root, 'rev-parse', 'HEAD').trim()
    fs.rmSync(path.join(p.root, 'docs/old.md'))
    runGit(p.root, 'add', '.')
    runGit(p.root, 'commit', '-q', '-m', 'delete old.md')

    // Against HEAD (the default), the deletion is already committed — nothing to compare.
    const againstHead = runCli(p.root, ['check', '--report-deletions', '--links-only'])
    expect(againstHead.stdout).not.toContain('### Unique Section')

    // Against the base commit (before the deletion), it's caught.
    const againstBase = runCli(p.root, ['check', '--report-deletions', '--deletions-since', baseSha, '--links-only'])
    expect(againstBase.stdout).toContain('### Unique Section')
  })

  // Issue #106 "best value defaults" audit: an unresolvable `--deletions-since`
  // ref (the single most likely real-world failure mode of this flag — a
  // shallow CI checkout that never fetched the base branch) must not be
  // mislabeled "git unavailable," which falsely implies git itself is
  // broken when it's the REF that doesn't exist. Previously untested via
  // real subprocess at all.
  it('--deletions-since with an unresolvable ref is skipped with a message naming the real cause, not "git unavailable"', () => {
    const p = project('cli-deletions-since-bad-ref', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/a.md': '# A\n\nShort.\n',
    })
    runGit(p.root, 'init', '-q')
    runGit(p.root, 'config', 'user.email', 'test@example.com')
    runGit(p.root, 'config', 'user.name', 'Test')
    runGit(p.root, 'add', '.')
    runGit(p.root, 'commit', '-q', '-m', 'initial')

    const result = runCli(p.root, ['check', '--report-deletions', '--deletions-since', 'totally-bogus-ref'])
    expect(result.exitCode).toBe(0) // links/summaries pass; --report-deletions is informational only
    expect(result.stdout).toContain('--report-deletions skipped:')
    expect(result.stdout).not.toContain('git unavailable')
    expect(result.stdout).toContain('totally-bogus-ref')
  })

  // Issue #106 "best value defaults" audit, round 6: every OTHER real
  // report string in this file has a matching `--locale fr` real-subprocess
  // proof (see the "--locale fr switches real report output" test below) —
  // the --report-deletions skip warning (a cli.ts-level string, not
  // formatDeletionsReport's own — that one's fr branch is separately unit-
  // tested in CheckDeletions.unit.test.ts) had none.
  it('--report-deletions skip warning localises to French too', () => {
    const p = project('cli-deletions-since-bad-ref-fr', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/a.md': '# A\n\nShort.\n',
    })
    runGit(p.root, 'init', '-q')
    runGit(p.root, 'config', 'user.email', 'test@example.com')
    runGit(p.root, 'config', 'user.name', 'Test')
    runGit(p.root, 'add', '.')
    runGit(p.root, 'commit', '-q', '-m', 'initial')

    const result = runCli(p.root, [
      'check',
      '--locale',
      'fr',
      '--report-deletions',
      '--deletions-since',
      'totally-bogus-ref',
    ])
    expect(result.stdout).toContain('--report-deletions ignoré :')
    expect(result.stdout).not.toContain('git indisponible')
  })

  // Issue #106 "best value defaults" audit, round 5: --fix physically
  // rewrites doc content BEFORE --report-deletions used to re-read the
  // corpus — an unrelated doc's broken link, once --fix repairs it to
  // coincidentally point at the SAME target a deleted doc used to link
  // to, silently counted as "surviving," under-reporting a real orphaned
  // link target. --report-deletions must now report the SAME finding
  // whether or not --fix ran alongside it in the same invocation.
  it('--report-deletions reports the same finding whether or not --fix ran in the same invocation', () => {
    const p = project('cli-report-deletions-fix-interaction', {
      '.cairnrc.json': JSON.stringify({ requireDirSummaries: false }),
      'docs/deleted.md': '# Deleted\n\n[guide](sub/guide.md)\n',
      // An unrelated, unambiguous --fix candidate: same basename, wrong
      // relative path — --fix will repair it to point at sub/guide.md,
      // the exact target docs/deleted.md (about to be removed) used.
      'docs/keeper.md': '# Keeper\n\n[guide](guide.md)\n',
      'docs/sub/guide.md': '# Guide\n',
    })
    runGit(p.root, 'init', '-q')
    runGit(p.root, 'config', 'user.email', 'test@example.com')
    runGit(p.root, 'config', 'user.name', 'Test')
    runGit(p.root, 'add', '.')
    runGit(p.root, 'commit', '-q', '-m', 'initial')
    fs.rmSync(path.join(p.root, 'docs/deleted.md'))

    const withoutFix = runCli(p.root, ['check', '--report-deletions', '--deletions-since', 'HEAD', '--links-only'])
    expect(withoutFix.stdout).toContain('link target nowhere else')

    const withFix = runCli(p.root, [
      'check',
      '--fix',
      '--report-deletions',
      '--deletions-since',
      'HEAD',
      '--links-only',
    ])
    expect(withFix.stdout).toContain('link target nowhere else')
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
