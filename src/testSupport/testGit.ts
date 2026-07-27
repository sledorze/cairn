// Test-only helper for integration tests that spawn a real `git` binary against a
// fresh temp repo (not the code under test — GitFsLive is what's under test; this is
// just fixture setup). Uses the same canonical env scrub as production (`gitEnv.ts`):
// a leaked GIT_DIR/GIT_INDEX_FILE/etc. from a git hook process would otherwise
// silently redirect `git init`/`git commit` here onto the OUTER repository instead of
// the intended temp repo — see `io/gitEnv.ts` for the full incident writeup.

import { execFileSync } from 'node:child_process'

import { scrubbedGitEnv } from '../io/gitEnv.ts'

export const runGit = (cwd: string, ...args: readonly string[]): void => {
  execFileSync('git', args, { cwd, env: scrubbedGitEnv(), stdio: 'pipe' })
}
