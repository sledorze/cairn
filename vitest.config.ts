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
        branches: 90.96,
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
        functions: 98.73,
        lines: 99.3,
        statements: 99.12,
      },
    },
    include: ['src/**/*.test.ts'],
  },
})
