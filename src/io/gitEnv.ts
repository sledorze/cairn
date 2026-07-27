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

import { execFileSync } from 'node:child_process'

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
 * child_process's undocumented skip-undefined-values behaviour is fragile. */
export const scrubbedGitEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env }
  for (const name of localEnvVarNames()) {
    delete env[name]
  }
  return env
}
