import { defineConfig, devices } from '@playwright/test';
import { AUTH_STORAGE_PATH, HTML_REPORT_DIR, TEST_OUTPUT_DIR } from './tests/e2e/run-context';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: TEST_OUTPUT_DIR,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: HTML_REPORT_DIR }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'x-playwright-smoke': '1' },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STORAGE_PATH,
        baseURL,
      },
      dependencies: ['setup'],
    },
  ],
});
