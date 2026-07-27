// git sets a handful of GIT_* environment variables to point commands at a specific
// repository/worktree/index — most visibly GIT_DIR, exported for hook subprocesses
// whenever the checkout is a linked `git worktree`. When cairn itself runs inside a
// git hook (its own README recommends wiring `cairn check` into pre-commit/pre-push;
// this repo's own lefthook.yml does exactly that), that leaked env silently overrides
// every `-C base` this module passes to `git` — `-C` only changes the working
// directory git starts from, it does not take precedence over an explicit GIT_DIR.
// Confirmed empirically: `GIT_DIR=<repo-a>/.git git -C <repo-b> ls-files` reports
// repo A's files, not repo B's. Left unscrubbed, `cairn check` run from a hook could
// silently consult the wrong repository's tracked/ignored/worktree state.
//
// `git rev-parse --local-env-vars` is git's own canonical answer to "which variables
// must be cleared to operate on a different repository" (see `git help githooks`,
// "If your hook needs to invoke Git commands in a foreign repository..."). Using it
// instead of a hardcoded list means a future git version that adds another such
// variable is handled with no code change here.
//
// Deliberately plain functions, not `Effect`s, even though `Git.ts`'s sibling
// functions in this same directory all shell out to `git` as `Effect<_, GitUnavailableError>`
// — this module's own `git rev-parse --local-env-vars` call is exactly that same class
// of fallible subprocess I/O, so the inconsistency is real, not overlooked. `effect`'s
// `unstable/process` `Command`/`ChildProcessSpawner` module (already available via this
// repo's pinned `effect` version, with built-in per-command env merging, and its live
// Node implementation already bundled in `NodeServices.layer` — which `src/cli.ts`
// already provides) is the properly idiomatic way to do this.
//
// Not adopted here for two independent reasons, of different weight:
//  1. `testSupport/testGit.ts`'s fixture helper (real `git init`/`add`/`commit` setup)
//     wraps `execFileSync` and is called synchronously from ~30 `beforeAll`/`it` bodies
//     across the existing integration test suites. An Effect-based env lookup can only
//     be consumed through `execFile` (async), which would force every one of those
//     call sites to become `async`/`await` too — a real, disproportionate ripple through
//     unrelated, already-working test code for what this module needs to do. This is a
//     hard constraint, not a preference.
//  2. `Git.ts`'s OWN call sites are, unlike the fixture helper, already 100% async
//     (`Effect.runPromise` at every consumer) — so converting *them* specifically to
//     `Command`/`ChildProcessSpawner` has no such sync wall. That one is a deferred
//     judgment call, not a blocker: it would mean rewriting already-tested, working,
//     pre-existing production logic (not just this fix's own new code) onto an API
//     `effect` itself still labels `unstable`, for a change whose actual bug (`GIT_DIR`
//     overriding `-C`) is already fully fixed by `env: scrubbedGitEnv()` without it. If
//     this codebase adopts `Command` more broadly for `io/`, `Git.ts` is where that
//     conversion belongs — this module would then follow, once its own consumer no
//     longer forces it to stay synchronous.

import { execFileSync } from 'node:child_process'
import * as nodePath from 'node:path'

// The `git rev-parse --local-env-vars` output as of git 2.49 — used only if the
// `git` call below fails (git absent, or too old to support the flag). This module
// must never be the reason `git` becomes unavailable to callers that already treat
// git as optional (GitUnavailableError).
const FALLBACK_LOCAL_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
] as const

/** The set of GIT_* variable names that point at a specific repository/worktree/index.
 * Not memoized: `cairn` is a short-lived CLI process that calls this at most a
 * handful of times per run, so the extra `git rev-parse` calls are negligible — and
 * skipping memoization keeps this independently testable (real PATH/binary swaps)
 * without a module-cache-reset workaround. */
export const localEnvVarNames = (): readonly string[] => {
  try {
    const stdout = execFileSync('git', ['rev-parse', '--local-env-vars'], { stdio: ['ignore', 'pipe', 'ignore'] })
    const names = stdout
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    return names.length > 0 ? names : FALLBACK_LOCAL_ENV_VARS
  } catch {
    return FALLBACK_LOCAL_ENV_VARS
  }
}

/** `process.env` with every repository-pinning GIT_* variable removed — safe to pass
 * as `execFile`'s `env` so an explicit `-C <base>` (or a fresh `git init` in a temp
 * dir) is authoritative instead of silently overridden by an inherited GIT_DIR (or
 * GIT_INDEX_FILE, GIT_WORK_TREE, ...). Uses `delete`, not `= undefined`: relying on
 * child_process's undocumented skip-undefined-values behaviour is fragile.
 *
 * Also sets `GIT_CEILING_DIRECTORIES` to `base`'s parent when `base` is given — a
 * second, independent hardening layer against a *different* failure mode than the
 * leaked-env one above: git's own repository discovery normally walks UPWARD from
 * `-C base` looking for a `.git`, so a `base` that doesn't (yet) have its own repo —
 * e.g. a fresh fixture directory before `git init` has run, or simply a caller passing
 * the wrong path — can silently resolve to an ANCESTOR repository instead of failing.
 * Confirmed empirically: from a repo-less subdirectory of a real repo,
 * `git -C <subdir> rev-parse --show-toplevel` finds the ANCESTOR's toplevel; with the
 * ceiling set to that subdirectory's parent, the same command correctly fails instead.
 * Git's own ceiling mechanism (`git help githooks`) enforces this — not an env-var
 * absence, a git built-in that continues to work even if some future code path
 * forgets to scrub an as-yet-unenumerated leaked variable. */
export const scrubbedGitEnv = (base?: string): NodeJS.ProcessEnv => {
  const env = { ...process.env }
  for (const name of localEnvVarNames()) {
    delete env[name]
  }
  if (base !== undefined) {
    env.GIT_CEILING_DIRECTORIES = nodePath.dirname(base)
  }
  return env
}
