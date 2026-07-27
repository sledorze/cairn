// Dogfoods the real package.json against the real files under src/ — cairn ships
// dist/cli.js fully bundled (esbuild --bundle), but the library entrypoint
// (exports["."] -> dist/index.js) is NOT bundled: its bare imports must resolve from
// a consumer's node_modules at runtime. `effect`, `@effect/platform-node`, and
// `github-slugger` used to sit in "dependencies", so every consumer installed all
// three even though only the bundled CLI needed any of them — and
// @effect/platform-node's required (non-optional) `ioredis` peer rode along for free.
// This test makes that class of drift self-correcting: any NEW bare import from a
// non-bundled module that isn't declared as a (peer) dependency fails here, and any
// import of @effect/platform-node from outside the bundled CLI entry fails here too.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')
const srcDir = path.join(repoRoot, 'src')

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

const toRepoRelative = (abs: string): string => path.relative(repoRoot, abs).split(path.sep).join('/')

const isShippedSourceFile = (f: string): boolean =>
  f.endsWith('.ts') &&
  !f.endsWith('.test.ts') &&
  !f.endsWith('.bench.ts') &&
  !f.startsWith('src/testSupport/') &&
  f !== 'src/cli.ts' // the one entrypoint esbuild fully bundles

// Anchored to line start (after leading whitespace) so prose inside comments that
// merely mentions the words "import"/"from" — e.g. a doc comment discussing link
// syntax — can never masquerade as a real import declaration.
const IMPORT_LINE_RE = /^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/

// A bare specifier's *package name* is what must be declared: `effect/PlatformError`
// is a subpath of the `effect` package, not a separate dependency.
const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier)
}

const extractBareSpecifiers = (source: string): string[] => {
  const specifiers: string[] = []
  for (const line of source.split('\n')) {
    const match = IMPORT_LINE_RE.exec(line)
    const specifier = match?.[1] ?? match?.[2]
    if (specifier && !specifier.startsWith('.') && !specifier.startsWith('node:')) {
      specifiers.push(packageNameOf(specifier))
    }
  }
  return specifiers
}

const packageJsonPath = path.join(repoRoot, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const allSrcFiles = listFilesRecursively(srcDir).map(toRepoRelative)

describe('package.json declares exactly the runtime deps the unbundled library entrypoint needs', () => {
  const shippedFiles = allSrcFiles.filter(isShippedSourceFile)

  it('sanity: there really are shipped, non-bundled source files under src/', () => {
    expect(shippedFiles.length).toBeGreaterThan(0)
  })

  it('every bare import from a shipped, non-bundled file is declared in dependencies or peerDependencies', () => {
    const declared = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ])
    const undeclared = shippedFiles.flatMap((relFile) => {
      const source = fs.readFileSync(path.join(repoRoot, relFile), 'utf8')
      return extractBareSpecifiers(source)
        .filter((specifier) => !declared.has(specifier))
        .map((specifier) => `${relFile} imports "${specifier}"`)
    })
    expect(undeclared).toEqual([])
  })

  it('sanity: shipped files really do import at least one bare specifier today (effect)', () => {
    const anyEffectImport = shippedFiles.some((relFile) =>
      extractBareSpecifiers(fs.readFileSync(path.join(repoRoot, relFile), 'utf8')).includes('effect'),
    )
    expect(anyEffectImport).toBeTruthy()
  })

  // Negative control: @effect/platform-node is what drags in ioredis as a required
  // peer (see the changeset for this fix). It must stay confined to the bundled CLI
  // entry (src/cli.ts) and integration tests — never a shipped, unbundled module —
  // or that peer dependency silently comes back for every consumer.
  it('@effect/platform-node is imported only from the bundled CLI entry or integration tests, never a shipped library module', () => {
    const offenders = shippedFiles.filter((relFile) =>
      extractBareSpecifiers(fs.readFileSync(path.join(repoRoot, relFile), 'utf8')).includes('@effect/platform-node'),
    )
    expect(offenders).toEqual([])
  })
})
