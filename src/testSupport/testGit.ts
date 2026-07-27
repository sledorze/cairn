// Test-only helper for integration tests that spawn a real `git` binary against a
// fresh temp repo (not the code under test — GitFsLive is what's under test; this is
// just fixture setup). git sets `GIT_DIR` for hook subprocesses when the outer
// checkout is a linked `git worktree` (confirmed: not for an ordinary clone/checkout,
// and not `GIT_WORK_TREE` or any other GIT_* var — only `GIT_DIR`). When these tests
// run under a pre-push hook from a worktree, that leaked `GIT_DIR` silently redirects
// every nested `git init`/`git commit` here onto the OUTER repository instead of the
// intended temp repo — corrupting real tracked files and polluting real history with
// throwaway fixture commits. Stripping it is required for isolation, not optional
// hygiene: without it, `git init` in `cwd` is a silent no-op against the wrong
// git-dir, and `git commit` lands on whatever branch the outer checkout has open.

import { execFileSync } from 'node:child_process'

export const runGit = (cwd: string, ...args: readonly string[]): void => {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_DIR: undefined }, stdio: 'pipe' })
}
