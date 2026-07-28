import * as fs from 'node:fs'
import * as path from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type * as Scope from 'effect/Scope'

import type { TempProject } from '../testSupport/tempProject.ts'
import { makeTempProject } from '../testSupport/tempProject.ts'
import { CliCheckFailedError, runCliCheckOnce } from './BenchCliCheck.ts'

// Exercises the REAL `node` binary (via effect's own ChildProcessSpawner, wired
// through @effect/platform-node's NodeServices.layer) — the exact bug this
// module fixes (a relative cliPath silently resolving against the wrong
// directory) only reproduces against a real subprocess, not an in-memory double.

/** Effect-native temp-project lifecycle, torn down by `it.effect`'s own per-test
 * `Scope` — matches src/io/Git.integration.test.ts's own `acquireTempDir` idiom. */
const acquireTempProject = (
  prefix: string,
  files: Record<string, string> = {},
): Effect.Effect<TempProject, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => makeTempProject(prefix, files)),
    (project) => Effect.sync(() => project.dispose()),
  )

it.layer(NodeServices.layer)('runCliCheckOnce', (layerIt) => {
  layerIt.effect('succeeds when the target script exits 0', () =>
    Effect.gen(function* () {
      const cli = yield* acquireTempProject('bench-cli-check-ok-', { 'cli.js': 'process.exit(0)\n' })
      const fixtureDir = yield* acquireTempProject('bench-cli-check-fixture-')
      yield* runCliCheckOnce(path.join(cli.root, 'cli.js'), fixtureDir.root)
    }),
  )

  layerIt.effect('fails with CliCheckFailedError carrying the real exit code when the script exits non-zero', () =>
    Effect.gen(function* () {
      const cli = yield* acquireTempProject('bench-cli-check-fail-', { 'cli.js': 'process.exit(1)\n' })
      const fixtureDir = yield* acquireTempProject('bench-cli-check-fixture-')
      const error = yield* Effect.flip(runCliCheckOnce(path.join(cli.root, 'cli.js'), fixtureDir.root))
      expect(error).toBeInstanceOf(CliCheckFailedError)
      if (error instanceof CliCheckFailedError) {
        expect(error['_tag']).toBe('CliCheckFailedError')
        expect(error.exitCode).toBe(1)
      }
    }),
  )

  // Asserts on the ACTUAL spawned command, not just its observable success/failure —
  // a mutant that dropped the `'check'` argv entry, or dropped `{ cwd }` entirely
  // (spawning in this test process's own cwd instead of the fixture), would still
  // exit 0 against a script that ignores its arguments, so neither prior test could
  // catch it. Confirmed as a real gap by mutation testing (Stryker survived both).
  layerIt.effect(
    'spawns node with the resolved cliPath, the literal "check" argument, and cwd set to the given directory',
    () =>
      Effect.gen(function* () {
        const marker = makeTempProject('bench-cli-check-marker-')
        const markerFile = path.join(marker.root, 'observed.json')
        const cli = yield* acquireTempProject('bench-cli-check-observe-', {
          'cli.js': `require('node:fs').writeFileSync(${JSON.stringify(markerFile)}, JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd() }))`,
        })
        const fixtureDir = yield* acquireTempProject('bench-cli-check-fixture-')
        try {
          yield* runCliCheckOnce(path.join(cli.root, 'cli.js'), fixtureDir.root)
          const observed = JSON.parse(fs.readFileSync(markerFile, 'utf8')) as { argv: string[]; cwd: string }
          expect(observed.argv).toEqual([path.join(cli.root, 'cli.js'), 'check'])
          expect(fs.realpathSync(observed.cwd)).toBe(fs.realpathSync(fixtureDir.root))
        } finally {
          marker.dispose()
        }
      }),
  )

  // The bug this test guards against: an EARLIER version spawned `node [cliPath,
  // 'check']` with `{ cwd: fixtureDir }` while passing `cliPath` through
  // UNRESOLVED — a relative path is resolved by Node against the CHILD's cwd
  // (the fixture), not the caller's own process.cwd(), so it threw
  // MODULE_NOT_FOUND the instant the fixture wasn't also the repo root
  // (confirmed by hand before the fix). Reproduced here directly: pass a path
  // RELATIVE TO THIS TEST PROCESS's cwd, spawn against a DIFFERENT directory as
  // `cwd`, and confirm it still finds and runs the script.
  layerIt.effect('resolves a relative cliPath against process.cwd(), not against the spawn cwd', () =>
    Effect.gen(function* () {
      const cli = yield* acquireTempProject('bench-cli-check-relpath-', { 'cli.js': 'process.exit(0)\n' })
      const fixtureDir = yield* acquireTempProject('bench-cli-check-fixture-')
      const relativeCliPath = path.relative(process.cwd(), path.join(cli.root, 'cli.js'))
      expect(path.isAbsolute(relativeCliPath)).toBeFalsy()
      yield* runCliCheckOnce(relativeCliPath, fixtureDir.root)
    }),
  )
})
