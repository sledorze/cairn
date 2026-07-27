import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// `localEnvVarNames()` memoizes at module scope, so each test forces a fresh module
// instance (`vi.resetModules()` + dynamic import) rather than mocking `child_process`
// — this exercises the real `git` binary (or its real absence), matching this
// codebase's "test real git behaviour" discipline elsewhere (Git.integration.test.ts).

describe('gitEnv', () => {
  const originalPath = process.env.PATH

  afterEach(() => {
    process.env.PATH = originalPath
    delete process.env.GIT_DIR
    delete process.env.SOME_UNRELATED_TEST_VAR
  })

  it('resolves the real canonical list from `git rev-parse --local-env-vars`', async () => {
    vi.resetModules()
    const { localEnvVarNames } = await import('./gitEnv.ts')
    const names = localEnvVarNames()
    expect(names).toContain('GIT_DIR')
    expect(names).toContain('GIT_INDEX_FILE')
    expect(names).toContain('GIT_WORK_TREE')
  })

  it('falls back to the known variable list when the `git` binary is unavailable', async () => {
    vi.resetModules()
    process.env.PATH = '/nonexistent-bin-dir-for-gitenv-test'
    const { localEnvVarNames } = await import('./gitEnv.ts')
    const names = localEnvVarNames()
    expect(names).toContain('GIT_DIR')
    expect(names.length).toBeGreaterThan(10)
  })

  it('falls back to the known variable list when `git` succeeds but prints nothing', async () => {
    vi.resetModules()
    const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitenv-fake-git-'))
    fs.writeFileSync(path.join(fakeBinDir, 'git'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    try {
      process.env.PATH = `${fakeBinDir}:${originalPath}`
      const { localEnvVarNames } = await import('./gitEnv.ts')
      const names = localEnvVarNames()
      expect(names).toContain('GIT_DIR')
      expect(names.length).toBeGreaterThan(10)
    } finally {
      fs.rmSync(fakeBinDir, { force: true, recursive: true })
    }
  })

  it('scrubbedGitEnv() removes every local env var but keeps unrelated ones', async () => {
    vi.resetModules()
    process.env.GIT_DIR = '/tmp/some-repo/.git'
    process.env.SOME_UNRELATED_TEST_VAR = 'keep-me'
    const { scrubbedGitEnv } = await import('./gitEnv.ts')
    const env = scrubbedGitEnv()
    expect(env.GIT_DIR).toBeUndefined()
    expect(env.SOME_UNRELATED_TEST_VAR).toBe('keep-me')
  })
})
