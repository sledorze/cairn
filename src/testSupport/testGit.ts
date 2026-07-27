// Test-only helper for integration tests that spawn a real `git` binary against a
// fresh temp repo (not the code under test — GitFsLive is what's under test; this is
// just fixture setup). Uses the same canonical env scrub + GIT_CEILING_DIRECTORIES as
// production (`gitEnv.ts`): a leaked GIT_DIR/GIT_INDEX_FILE/etc. from a git hook
// process would otherwise silently redirect `git init`/`git commit` here onto the
// OUTER repository instead of the intended temp repo — see `io/gitEnv.ts` for the
// full incident writeup.
//
// Additionally hermetic in a way production `Git.ts` deliberately is NOT: `GIT_CONFIG_GLOBAL`/
// `GIT_CONFIG_SYSTEM=/dev/null` and a dedicated throwaway `HOME`, so a contributor's
// real `~/.gitconfig` (`commit.gpgsign=true`, `core.hooksPath`, their own `user.*`) can
// never bleed into what's meant to be a hermetic fixture repo — real config isolation,
// not test-code assumptions about what a fixture commit's author ends up being. Only
// the fixture helper does this; `Git.ts`'s own production calls must still respect a
// real user's real git config (e.g. credential helpers, proxy settings).

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { scrubbedGitEnv } from '../io/gitEnv.ts'

// One dedicated, shared-for-the-process-lifetime throwaway HOME — not per-call or
// per-test, since it holds nothing test-specific (only used to keep a real
// `~/.gitconfig` out of the picture), and OS temp cleanup reclaims it naturally.
const fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'testGit-home-'))

export const runGit = (cwd: string, ...args: readonly string[]): void => {
  const env = scrubbedGitEnv(cwd)
  env.HOME = fixtureHome
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_SYSTEM = '/dev/null'
  execFileSync('git', args, { cwd, env, stdio: 'pipe' })
}
