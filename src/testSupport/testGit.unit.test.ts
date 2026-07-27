import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runGit } from './testGit.ts'

// Proves runGit()'s config isolation is real, not assumed: constructs a fake "ambient
// dev machine" HOME with a distinctive global user.name, confirms (a) that ambient
// config really would leak into a plain execFileSync git call with no isolation — the
// negative control, proving the setup is valid — and (b) that runGit() specifically
// does NOT pick it up, because GIT_CONFIG_GLOBAL=/dev/null + its own dedicated HOME
// override real ambient config, not just override an already-inert default.
describe('runGit() config isolation (regression)', () => {
  const originalHome = process.env.HOME

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  })

  it("a fixture commit made via runGit() does NOT pick up an ambient ~/.gitconfig's user.name", () => {
    const fakeAmbientHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-ambient-home-'))
    fs.writeFileSync(
      path.join(fakeAmbientHome, '.gitconfig'),
      '[user]\n\tname = AmbientLeakedUser\n\temail = ambient@example.com\n',
    )
    process.env.HOME = fakeAmbientHome

    // Negative control: with NO isolation at all, this same fake ambient HOME really
    // does supply a usable identity — proving the fixture below is a meaningful test,
    // not a no-op against an already-empty ambient config.
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitconfig-leak-control-'))
    execFileSync('git', ['init', '-q'], { cwd: repoRoot, env: process.env })
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'a')
    execFileSync('git', ['add', 'a.txt'], { cwd: repoRoot, env: process.env })
    execFileSync('git', ['commit', '-q', '-m', 'control'], { cwd: repoRoot, env: process.env })
    const controlAuthor = execFileSync('git', ['log', '-1', '--format=%an <%ae>'], {
      cwd: repoRoot,
      env: process.env,
    }).toString()
    expect(controlAuthor).toContain('AmbientLeakedUser')

    // The real assertion: runGit(), with the SAME ambient HOME set, must not pick up
    // that identity — no local user.name/email is set here, deliberately, so isolation
    // failing would surface as either the ambient identity or a hard "identity unknown"
    // failure, never a silent success with the wrong author.
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitconfig-leak-fixture-'))
    runGit(fixtureRoot, 'init', '-q')
    fs.writeFileSync(path.join(fixtureRoot, 'b.txt'), 'b')
    runGit(fixtureRoot, 'add', 'b.txt')
    expect(() => runGit(fixtureRoot, 'commit', '-q', '-m', 'fixture')).toThrow('Author identity unknown')
  })
})
