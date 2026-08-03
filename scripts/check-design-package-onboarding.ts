// Closes the "silent onboarding gap" found while stress-testing docs/design/CONVENTION.md's
// own checks.coverage-based structural enforcement: scoping every kind id/glob to an EXACT
// package path (docs/design/CONVENTION.md's "Is any of this actually capturable?" section)
// closes real adversarial gaming, but means a genuinely NEW design package that nobody
// remembers to wire into .cairnrc.json gets ZERO structural checking — worse than the
// original wildcard version for the honest "forgot a piece" case this whole convention
// exists to catch. Verified concretely: a throwaway package with only a problem-space.md
// (6 of 7 required docs missing) produced zero warnings until this script existed.
//
// Mirrors scripts/check-changeset.sh's own shape: a single script, callable identically
// from lefthook's local pre-push hook and from CI, so a contributor who bypasses the local
// hook is still caught. Reuses core/glob.ts's own matcher — the SAME matching cairn itself
// uses for `checks.coverage`'s kind globs — rather than a second, potentially-divergent
// glob implementation.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { matchesAny } from '../src/core/glob.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const designRoot = path.join(repoRoot, 'docs', 'design')

const listDesignPackages = (): string[] => {
  if (!fs.existsSync(designRoot)) {
    return []
  }
  return fs
    .readdirSync(designRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(designRoot, entry.name, '_SUMMARY.md'))
    .filter((summaryPath) => fs.existsSync(summaryPath))
}

const configPath = path.join(repoRoot, '.cairnrc.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const kindGlobs: string[] = (config.checks?.coverage?.kinds ?? []).map(
  (k: { select: { glob: string } }) => k.select.glob,
)

const toPosix = (p: string): string => p.replaceAll('\\', '/')

const packages = listDesignPackages()
const unonboarded = packages.filter((summaryPath) => !matchesAny(toPosix(summaryPath), kindGlobs))

if (unonboarded.length === 0) {
  console.log(`check-design-package-onboarding: all ${packages.length} design package(s) onboarded. OK.`)
  process.exit(0)
}

console.error('check-design-package-onboarding: design package(s) with no matching checks.coverage kind:')
for (const p of unonboarded) {
  console.error(`  ${path.relative(repoRoot, path.dirname(p))}`)
}
console.error('')
console.error("A design package with no matching kind gets ZERO structural checking (see docs/design/CONVENTION.md's")
console.error('"Is any of this actually capturable?" section for why this is deliberately not permissive by default).')
console.error('Add a scoped checks.coverage kinds/rules block for it to .cairnrc.json in this same PR —')
console.error("see docs/design/CONVENTION.md's own config block for the exact shape to copy.")
process.exit(1)
