// Guards README.md against silently omitting a real CLI flag. Unlike
// `jsonIncompatibility.readme.unit.test.ts` (which checks one specific claim
// — the 7 `--json` incompatibilities — against a hand-maintained list), this
// test walks EVERY `Flag.<kind>('name')` declaration in `cli.ts`'s own
// source and asserts the flag's name is mentioned somewhere in README —
// so a brand new flag added later with no README coverage fails here too,
// not just the two ad hoc cases that happened to get noticed once (see
// AGENTS.md: "a new restriction must be discoverable, not just correct").
//
// Found real, pre-existing gaps on first run (RED, per this repo's own
// RED-before-GREEN convention): `--root`, `--explain`, `--config`,
// `--threshold`, `--locale` were all working flags (confirmed via `--help`)
// with zero mention in README — fixed by adding the "Other flags" table
// alongside this test, in the same change.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
const cliSource = fs.readFileSync(path.join(repoRoot, 'src', 'cli.ts'), 'utf8')

// `Flag.boolean('x')` / `Flag.string('x')` / `Flag.integer('x')` /
// `Flag.choice('x', ...)` — every flag-DECLARING kind `cli.ts` actually
// uses (confirmed by grep across the file). Deliberately NOT `Flag\.\w+\(`
// (matches any `Flag.*` call): `Flag.withDefault('all')` — a value, not a
// flag name — is a real false positive that exact broader pattern hit on
// first run; anchoring to the 4 kinds that actually name a flag avoids it.
const FLAG_DECL_RE = /Flag\.(?:boolean|string|integer|choice)\(\s*'([\w-]+)'/g

const declaredFlags = [...cliSource.matchAll(FLAG_DECL_RE)].map((m) => m[1])

describe('README.md documents every CLI flag cli.ts declares', () => {
  it('sanity: flags were actually found via the regex (extraction did not silently break)', () => {
    expect(declaredFlags.length).toBeGreaterThan(5)
  })

  it.each(declaredFlags)('--%s is mentioned somewhere in README', (flag) => {
    expect(readme).toContain(`--${flag}`)
  })
})
