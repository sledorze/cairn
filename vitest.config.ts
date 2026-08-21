import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
    coverage: {
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test-d.ts',
        'src/**/*.bench.ts',
        'src/testSupport/**',
        'scripts/**',
        // Thin argv-parsing/wiring entrypoint, exercised only via real
        // subprocess dogfooding (lefthook's `docs` step, CI, manual
        // `npm pack`/`node dist/cli.js` runs) per this repo's own
        // "dogfood the actual CLI" convention (AGENTS.md) — never
        // in-process, so v8 coverage instrumentation can't see it.
        'src/cli.ts',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // A ratchet, not a fixed bar: autoUpdate rewrites these numbers up to
      // match reality whenever coverage improves, and `vitest run --coverage`
      // fails only on a genuine regression below the last-committed value —
      // never on a static, easily-stale percentage.
      thresholds: {
        autoUpdate: true,
        // branches: 92.5 (down from 92.51), functions: 98.91 (down from
        // 98.92) — `core/Config.ts`'s `checkAtLeastSane` dropped its own
        // `JSON.stringify`-based duplicate-target branch (a `Set`/`.map()`
        // lambda in the denominator) once `docs/design/review-findings.md`
        // section 7 discovered, by construction, that the new
        // `atLeastOfUniqueFilter` (`Schema.isUnique()`, added for
        // `uniqueItems: true` JSON-Schema discoverability) already runs
        // FIRST and structurally subsumes it — a pure ratio shift from
        // removing now-dead code, the same "denominator shrinks along with
        // the numerator, no real coverage lost" shape as this file's own
        // `readDirsSafe` precedent below.
        // branches: 92.44 (down from 92.5) — `CheckDocCoverage.ts`'s own
        // `matchesConfiguredGlob` and `CheckFreshness.ts`'s own
        // `matchesRuleGlob` were two independently re-derived, verbatim
        // (but for a single-glob-vs-array-of-globs argument shape) copies
        // of the exact same "match both absolute and base-relative" `||`
        // check, each fully covered by its own file's tests. Consolidated
        // into one shared `matchesGlobNearBase` (`core/paths.ts`), itself
        // fully covered by its own new direct unit tests. Removing two
        // fully-covered `||` branches from the denominator (dedup, not a
        // coverage loss) drops the GLOBAL ratio below the mean the same
        // "denominator shrinks along with the numerator" way this file's
        // own `checkAtLeastSane` precedent above already explains — the
        // math looks like a regression only because the removed branches
        // were covered at 100%, above the overall average.
        branches: 93.13,
        // functions/statements: manually recalibrated (config.ts's move to
        // Effect's FileSystem service), not auto-raised.
        // `assertNoRootEscape`'s `fs.realPath(dir)` failure-recovery
        // callback is TOCTOU-only: `isDir` already confirmed the same path
        // via a successful `fs.stat` moments earlier, so there's no
        // deterministic way to make `realPath` fail on it in a test
        // (same reasoning as this file's own prior recalibration for the
        // pre-Effect version of this exact check). Every other new
        // Effect-shaped branch this rewrite introduced (readDirsSafe's own
        // real-filesystem failure path included) is now covered for real.
        // 98.61 (down from 98.62): `readDirsSafe` dropped its last raw
        // `node:fs/promises` call (now `FileSystem.readDirectory` + a
        // per-entry `isDir`, closing the one remaining non-Effect gap in
        // this file) — that removed a handful of anonymous callback
        // functions (the old `Effect.tryPromise`/`Array.filter`/`.map`
        // lambdas) from the denominator along with the numerator, a pure
        // ratio shift with no coverage lost: every real branch this
        // rewrite touches (the mixed file/directory glob-segment case
        // included) has its own real-filesystem test.
        functions: 99.05,
        lines: 99.56,
        statements: 99.41,
      },
    },
    // scripts/**/*.test.ts: a genuine exception to "tests live under src/" —
    // issue #111's check-changeset.sh is dev tooling (excluded from coverage
    // above, same as every other scripts/*.ts), but still needs a real,
    // permanent test per this repo's own "convert every dogfooding proof
    // into a test" rule, and belongs directly alongside the script it tests.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
