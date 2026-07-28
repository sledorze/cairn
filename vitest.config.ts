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
        branches: 89.35,
        functions: 98.76,
        lines: 99.05,
        statements: 98.91,
      },
    },
    include: ['src/**/*.test.ts'],
  },
})
