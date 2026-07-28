import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG } from '../../core/Config.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import type { CheckCliFlags, CheckPlugin, CheckRunArgs } from './CheckPlugin.ts'
import { rejectedJsonMessage, runCheckPlugin } from './runCheckPlugin.ts'

const CLI_DEFAULTS: CheckCliFlags = {
  fix: false,
  json: false,
  linksOnly: false,
  prose: false,
  refs: false,
  stamp: false,
  summariesOnly: false,
}

const args = (overrides: Partial<CheckRunArgs> = {}): CheckRunArgs => ({
  base: '/r',
  cli: CLI_DEFAULTS,
  ignore: [],
  resolved: DEFAULT_CONFIG,
  roots: ['/r'],
  ...overrides,
})

// A minimal fake plugin — always enabled, "result" is just a number so
// exitCode/format have something trivial and unambiguous to react to.
const fakePlugin: CheckPlugin<number> = {
  exitCode: (n) => (n > 0 ? 1 : 0),
  format: (n, { locale }) => [locale === 'fr' ? `fr:${n}` : `en:${n}`],
  isEnabled: () => true,
  name: 'fake',
  run: () => Effect.succeed(3),
}

const layer = makeTestDocsFs({})

describe('runCheckPlugin()', () => {
  // Adversarial finding (round 3): a flat `{ ran: boolean; result: Result |
  // null; ... }` shape used `null` as an "didn't run" sentinel — ambiguous
  // the moment a real `Result` type could itself legitimately be `null`
  // (not hypothetical: `checks.coverage` is exactly `CoverageConfig | null`
  // elsewhere in this same codebase). A discriminated union
  // (`{ ran: false }` vs. `{ ran: true; result: Result; ... }`) makes that
  // ambiguity structurally impossible — a disabled outcome has no `result`
  // FIELD at all, not a `result: null` a real nullable Result could collide
  // with, and TypeScript itself refuses to let a caller read `.result`
  // without first narrowing on `.ran`.
  it('does not run a disabled plugin at all — a `{ ran: false }` outcome with no other fields', async () => {
    const disabled: CheckPlugin<number> = { ...fakePlugin, isEnabled: () => false }
    const outcome = await Effect.runPromise(runCheckPlugin(disabled, args()).pipe(Effect.provide(layer)))
    expect(outcome).toEqual({ ran: false })
  })

  it('runs an enabled plugin and returns its formatted lines + exit code + raw result', async () => {
    const outcome = await Effect.runPromise(runCheckPlugin(fakePlugin, args()).pipe(Effect.provide(layer)))
    expect(outcome).toEqual({ code: 1, lines: ['en:3'], ran: true, result: 3 })
  })

  it('formats in the requested locale', async () => {
    const outcome = await Effect.runPromise(
      runCheckPlugin(fakePlugin, args({ resolved: { ...DEFAULT_CONFIG, locale: 'fr' } })).pipe(Effect.provide(layer)),
    )
    expect(outcome).toEqual({ code: 1, lines: ['fr:3'], ran: true, result: 3 })
  })

  // Matches today's exact `if (!parsed.json) { Console.log(...) }` behavior
  // for refs/proseRefs/coverage: when a plugin CAN reach `run()` under
  // `--json` (only possible if it has no `jsonUnsupportedMessage`, i.e.
  // links today), its formatted lines are suppressed, but the exit code
  // still reflects the real result — buildJsonReport needs the raw
  // `result`, not the printed lines, which is why `result` always survives.
  it('suppresses printed lines under --json but still returns the exit code and raw result', async () => {
    const outcome = await Effect.runPromise(
      runCheckPlugin(fakePlugin, args({ cli: { ...CLI_DEFAULTS, json: true } })).pipe(Effect.provide(layer)),
    )
    expect(outcome).toEqual({ code: 1, lines: [], ran: true, result: 3 })
  })

  it('a passing result formats real content and yields exit code 0', async () => {
    const passing: CheckPlugin<number> = { ...fakePlugin, run: () => Effect.succeed(0) }
    const outcome = await Effect.runPromise(runCheckPlugin(passing, args()).pipe(Effect.provide(layer)))
    expect(outcome).toEqual({ code: 0, lines: ['en:0'], ran: true, result: 0 })
  })
})

describe('rejectedJsonMessage()', () => {
  const withMessage = (name: string, enabled: boolean): CheckPlugin<number> => ({
    ...fakePlugin,
    isEnabled: () => enabled,
    jsonUnsupportedMessage: `--json cannot be combined with --${name} yet`,
    name,
  })

  it('is null when --json was not requested at all, regardless of plugin state', () => {
    expect(rejectedJsonMessage([withMessage('refs', true)], DEFAULT_CONFIG, CLI_DEFAULTS)).toBeNull()
  })

  it('is null when --json is requested but no enabled plugin declares an incompatibility', () => {
    const cli = { ...CLI_DEFAULTS, json: true }
    expect(rejectedJsonMessage([fakePlugin], DEFAULT_CONFIG, cli)).toBeNull()
  })

  it('is null when the incompatible plugin exists but is NOT enabled — --json alone must not falsely reject', () => {
    const cli = { ...CLI_DEFAULTS, json: true }
    expect(rejectedJsonMessage([withMessage('refs', false)], DEFAULT_CONFIG, cli)).toBeNull()
  })

  it('returns the enabled incompatible plugin’s own message', () => {
    const cli = { ...CLI_DEFAULTS, json: true }
    expect(rejectedJsonMessage([withMessage('refs', true)], DEFAULT_CONFIG, cli)).toBe(
      '--json cannot be combined with --refs yet',
    )
  })

  // Matches cli.ts's existing sequential precedence exactly (refs checked
  // before prose before coverage) — the FIRST enabled+incompatible plugin
  // in registry order wins, not the last, so migrating cli.ts onto this
  // helper can't silently swap which error message a user sees.
  it('returns the FIRST enabled incompatible plugin in list order when more than one applies', () => {
    const cli = { ...CLI_DEFAULTS, json: true }
    const plugins = [withMessage('refs', true), withMessage('prose', true)]
    expect(rejectedJsonMessage(plugins, DEFAULT_CONFIG, cli)).toBe('--json cannot be combined with --refs yet')
  })
})
