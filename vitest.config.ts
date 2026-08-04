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
        branches: 92.51,
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
        functions: 98.91,
        lines: 99.44,
        statements: 99.27,
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
