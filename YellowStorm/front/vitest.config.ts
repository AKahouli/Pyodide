import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // pretendToBeVisual gives jsdom a working requestAnimationFrame, which the
    // streaming coalescer (store.ts) schedules its per-frame flushes on.
    environmentOptions: { jsdom: { pretendToBeVisual: true } },
    setupFiles: './src/test/setup.ts', // if you have setup file
    // Playwright e2e specs live under tests/e2e and must not run in Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', '**/cypress/**', '**/tests/e2e/**'],
    // Cap concurrency to avoid vitest-worker RPC timeouts (fetch / resolveSnapshotPath)
    // under heavy full-suite load on Windows.
    pool: 'forks',
    maxWorkers: 4,
    minWorkers: 1,
    fileParallelism: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/mockData.ts',
        '**/*.config.{ts,js}',
        '**/types.ts',
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});