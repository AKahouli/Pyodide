import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

// The launcher assigns one ID; Playwright workers inherit it through the environment.
export const E2E_RUN_ID = process.env.PLAYWRIGHT_RUN_ID ?? randomUUID();
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(E2E_RUN_ID)) {
  throw new Error('PLAYWRIGHT_RUN_ID must contain 1-80 letters, digits, underscores, or hyphens');
}
process.env.PLAYWRIGHT_RUN_ID = E2E_RUN_ID;

export const AUTH_STORAGE_PATH = join('tests', 'e2e', '.auth', E2E_RUN_ID, 'storage-state.json');
export const TEST_OUTPUT_DIR = join('test-results', E2E_RUN_ID);
export const HTML_REPORT_DIR = join('playwright-report', E2E_RUN_ID);
