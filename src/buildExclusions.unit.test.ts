// Dogfoods this project's OWN glob matcher (core/glob.ts) against the real
// tsconfig.build.json and the real files under src/ — issue #57: a real
// `npm pack --dry-run` found *.bench.ts files leaking into the published
// dist/ tarball because tsconfig.build.json's exclude list was never
// extended to match when benchmark files were introduced (it already
// excludes *.test.ts and testSupport/** for the same reason). This test
// makes that class of gap self-correcting: any NEW *.bench.ts or
// *.test.ts file that isn't actually excluded from the build fails here,
// rather than silently shipping in a future release.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

import { matchesAny } from './core/glob.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const tsconfigBuildPath = path.join(repoRoot, 'tsconfig.build.json')

const listFilesRecursively = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(abs))
    } else {
      out.push(abs)
    }
  }
  return out
}

/** `tsconfig.build.json`'s `exclude` patterns are relative to the repo
 * root (where the config file lives) — matched against `src/...`-relative
 * paths the same way `core/glob.ts`'s own `ignore`/`roots` patterns are,
 * for consistency with the one glob matcher this whole codebase uses. */
const toRepoRelative = (abs: string): string => path.relative(repoRoot, abs).split(path.sep).join('/')

describe('tsconfig.build.json excludes every dev-only file from the published dist/ (issue #57)', () => {
  const { exclude } = JSON.parse(fs.readFileSync(tsconfigBuildPath, 'utf8')) as { exclude: readonly string[] }
  const srcDir = path.join(repoRoot, 'src')
  const allSrcFiles = listFilesRecursively(srcDir).map(toRepoRelative)

  it('the config actually has a non-empty exclude list (sanity — a passing test here must mean something)', () => {
    expect(exclude.length).toBeGreaterThan(0)
  })

  it('excludes every real *.bench.ts file under src/', () => {
    const benchFiles = allSrcFiles.filter((f) => f.endsWith('.bench.ts'))
    expect(benchFiles.length).toBeGreaterThan(0) // sanity: this repo really has bench files today
    const unexcluded = benchFiles.filter((f) => !matchesAny(f, exclude))
    expect(unexcluded).toEqual([])
  })

  it('excludes every real *.test.ts file under src/', () => {
    const testFiles = allSrcFiles.filter((f) => f.endsWith('.test.ts'))
    expect(testFiles.length).toBeGreaterThan(0) // sanity
    const unexcluded = testFiles.filter((f) => !matchesAny(f, exclude))
    expect(unexcluded).toEqual([])
  })

  it('excludes every real file under src/testSupport/', () => {
    const testSupportFiles = allSrcFiles.filter((f) => f.startsWith('src/testSupport/'))
    expect(testSupportFiles.length).toBeGreaterThan(0) // sanity
    const unexcluded = testSupportFiles.filter((f) => !matchesAny(f, exclude))
    expect(unexcluded).toEqual([])
  })

  // Negative control, matching this codebase's own "never scope a write/
  // exclusion by content-pattern alone" discipline (AGENTS.md) applied here
  // to a READ-side check instead: a real, non-dev shipped source file must
  // NOT be excluded — proves the patterns are precise, not accidentally
  // broad enough to swallow real shipped code too.
  it('does NOT exclude a real, shipped (non-test, non-bench, non-testSupport) source file', () => {
    expect(matchesAny('src/cli.ts', exclude)).toBeFalsy()
    expect(matchesAny('src/io/DocsFs.ts', exclude)).toBeFalsy()
  })
})
