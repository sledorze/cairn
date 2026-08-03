// Real-subprocess proof for issue #111's check-changeset.sh: a genuine dogfooding
// gap an adversarial review found (a 5-scenario manual dogfood was done, but never
// converted into a permanent test — this repo's own "convert every dogfooding proof
// into a test" rule). Builds a real, disposable git repo (via testSupport/testGit.ts's
// `runGit`, the same hermetic-env helper Git.integration.test.ts uses) seeded with
// THIS repo's own script + its two `.regex` classifier files, so the script runs
// exactly as it would in real deployment — not an in-memory double standing in for
// git or the filesystem.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import { runGit } from '../src/testSupport/testGit.ts'

const SCRIPT = path.resolve(import.meta.dirname, 'check-changeset.sh')
const REQUIRED_RE = path.resolve(import.meta.dirname, 'changeset-required-paths.regex')
const EXEMPT_RE = path.resolve(import.meta.dirname, 'changeset-exempt-paths.regex')

const repos: string[] = []

afterEach(() => {
  while (repos.length > 0) {
    const dir = repos.pop()
    if (dir) {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  }
})

/** A real git repo, seeded with the script under test + its classifier files
 * (copied in, matching how they'd actually sit in a real consuming checkout),
 * with `main` as an initial commit ready to branch off of. */
const makeRepo = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-changeset-'))
  repos.push(root)
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, '.changeset'), { recursive: true })
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/check-changeset.sh'))
  fs.chmodSync(path.join(root, 'scripts/check-changeset.sh'), 0o755)
  fs.copyFileSync(REQUIRED_RE, path.join(root, 'scripts/changeset-required-paths.regex'))
  fs.copyFileSync(EXEMPT_RE, path.join(root, 'scripts/changeset-exempt-paths.regex'))
  fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 1\n')
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n')
  runGit(root, 'init', '-q', '-b', 'main')
  runGit(root, 'config', 'user.email', 'a@b.c')
  runGit(root, 'config', 'user.name', 'test')
  runGit(root, 'add', '-A')
  runGit(root, 'commit', '-q', '-m', 'init')
  return root
}

/** Runs the script against `main` as the base ref — never exercises the
 * no-arg auto-detection path (that's `main`'s own concern below); every
 * OTHER test passes `main` explicitly, matching how CI always invokes it
 * (`origin/${{ github.base_ref }}`) rather than relying on local `@{u}`. */
const run = (root: string, baseRef = 'main'): { readonly code: number; readonly stdout: string } => {
  try {
    const stdout = execFileSync(SCRIPT, [baseRef], { cwd: root, encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (error) {
    const e = error as { status: number | null; stdout: string }
    return { code: e.status ?? 1, stdout: e.stdout }
  }
}

describe('check-changeset.sh', () => {
  it('fails when a src/*.ts file changes with no new changeset', () => {
    const root = makeRepo()
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 2\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'change foo')
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('src/foo.ts')
  })

  it('passes when the same src/*.ts change also adds a changeset', () => {
    const root = makeRepo()
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 2\n')
    fs.writeFileSync(path.join(root, '.changeset/fix-foo.md'), '---\n---\nFixed foo.\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'change foo + changeset')
    const result = run(root)
    expect(result.code).toBe(0)
  })

  it('passes when only test/testSupport files change — no changeset needed', () => {
    const root = makeRepo()
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.mkdirSync(path.join(root, 'src/testSupport'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/testSupport/helper.ts'), '// helper\n')
    fs.writeFileSync(path.join(root, 'src/foo.test.ts'), "test('x', () => {})\n")
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'test-only changes')
    const result = run(root)
    expect(result.code).toBe(0)
  })

  it('fails when README.md changes with no new changeset', () => {
    const root = makeRepo()
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.appendFileSync(path.join(root, 'README.md'), '\nMore docs.\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'update README')
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('README.md')
  })

  it('passes via the `pnpm changeset --empty` escape hatch (a committed changeset with no package bump)', () => {
    const root = makeRepo()
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.appendFileSync(path.join(root, 'README.md'), '\nMore docs.\n')
    fs.writeFileSync(path.join(root, '.changeset/ack.md'), '---\n---\nNo user-facing change.\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'update README + empty changeset ack')
    const result = run(root)
    expect(result.code).toBe(0)
  })

  // Adversarial review finding: a DELETED changeset (exactly what the
  // changesets bot's own "Version Packages" PR does — consumes changesets by
  // removing them, never adds new ones) must NOT be mistaken for a NEW one
  // just because its path still matches `.changeset/*.md` in `--name-only`.
  it('does not count a DELETED changeset as satisfying the requirement', () => {
    const root = makeRepo()
    fs.writeFileSync(path.join(root, '.changeset/existing.md'), '---\n---\nPre-existing.\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'seed an existing changeset on main')
    runGit(root, 'checkout', '-q', '-b', 'release')
    fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 2\n')
    fs.rmSync(path.join(root, '.changeset/existing.md'))
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'consume the changeset, bump src too')
    const result = run(root)
    expect(result.code).toBe(1)
  })

  // Second adversarial review finding: `--diff-filter=A` alone (added-only)
  // excludes a RENAME — git reports "delete old name, create new name" as a
  // rename (R) whenever the content is similar enough, not an add, by
  // default. A legitimate "I renamed my changeset file" edit must still
  // count as present.
  it('counts a RENAMED changeset (not just a freshly-added one) as satisfying the requirement', () => {
    const root = makeRepo()
    fs.writeFileSync(
      path.join(root, '.changeset/existing.md'),
      '---\n---\nPre-existing content, long enough that git detects a rename rather than a delete+add pair when only the filename changes.\n',
    )
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'seed an existing changeset on main')
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 2\n')
    runGit(root, 'mv', '.changeset/existing.md', '.changeset/renamed.md')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'rename the changeset, bump src too')
    expect(runGit(root, 'diff', '--name-status', 'main', 'HEAD')).toMatch(/^R/m)
    const result = run(root)
    expect(result.code).toBe(0)
  })

  it('falls back to origin/main when origin/HEAD has no symref set locally', () => {
    const root = makeRepo()
    const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'check-changeset-remote-'))
    repos.push(bareRemote)
    runGit(bareRemote, 'init', '-q', '--bare', '-b', 'main')
    runGit(root, 'remote', 'add', 'origin', bareRemote)
    runGit(root, 'push', '-q', 'origin', 'main')
    // Deliberately no `git remote set-head` — proves the origin/main
    // fallback itself, not just the origin/HEAD symref path the other
    // auto-detection test already covers.
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 2\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'change foo, no changeset')
    runGit(root, 'push', '-q', '-u', 'origin', 'feature')
    const result = run(root, '')
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('src/foo.ts')
  })

  // Adversarial review's critical finding: `@{u}` (the branch's own
  // remote-tracking ref) is the WRONG default — it compares against wherever
  // this branch was last pushed, not the branch it will merge into, so a
  // normal single-push workflow saw an empty diff and silently passed.
  // `origin/HEAD`'s symref (what the fixed script now falls back to) must
  // resolve to the real default branch instead.
  it('falls back to origin/HEAD (not @{u}) when no base ref is given, catching a real PR diff', () => {
    const root = makeRepo()
    const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'check-changeset-remote-'))
    repos.push(bareRemote)
    runGit(bareRemote, 'init', '-q', '--bare', '-b', 'main')
    runGit(root, 'remote', 'add', 'origin', bareRemote)
    runGit(root, 'push', '-q', 'origin', 'main')
    runGit(root, 'remote', 'set-head', 'origin', 'main')
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 2\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'change foo, no changeset')
    runGit(root, 'push', '-q', '-u', 'origin', 'feature')
    // No base ref argument — exercises the auto-detection path directly.
    const result = run(root, '')
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('src/foo.ts')
  })

  // Third adversarial review finding: an OLD changeset already sitting in the
  // repo from before the branch point — left completely untouched by this
  // PR — must NOT count as "a changeset is present." The requirement is
  // that THIS PR carries its own new changeset, not merely that one exists
  // somewhere in the repo's history. `--diff-filter=AR` already gets this
  // right (an untouched file appears nowhere in the diff at all), but
  // nothing pinned it as a permanent test before this.
  it('does not count a pre-existing, untouched changeset as satisfying the requirement', () => {
    const root = makeRepo()
    fs.writeFileSync(path.join(root, '.changeset/old.md'), '---\n---\nAn older, unrelated changeset.\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'seed an old changeset on main')
    runGit(root, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(root, 'src/foo.ts'), 'export const x = 2\n')
    runGit(root, 'add', '-A')
    runGit(root, 'commit', '-q', '-m', 'change foo, no new changeset')
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('src/foo.ts')
  })
})
