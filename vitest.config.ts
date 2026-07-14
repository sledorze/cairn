import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
    include: ['src/**/*.test.ts'],
  },
})
