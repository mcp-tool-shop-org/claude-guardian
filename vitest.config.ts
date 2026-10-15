import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      // A floor, not a target: the line coverage CI measures (Linux), rounded
      // down, so it cannot slip. Raise it when the number rises. The bar is 90.
      thresholds: { lines: 72 },
    },
  },
});
