/**
 * Playwright auth setup. Runs once before the `chromium` project and
 * writes a `storageState` JSON that pre-populates the browser context
 * for every subsequent spec. The SPA keeps the access token in memory
 * only; session continuity comes from the HttpOnly refresh cookie, so
 * the login must run inside the page (credentials included) to land the
 * Set-Cookie in the context's cookie jar — the app then boot-restores
 * from it via restoreSessionFromCookie().
 */
import { test as setup, expect } from '@playwright/test';
import { API_BASE_URL, FRONTEND_BASE_URL } from './fixtures';
import { AUTH_STORAGE_PATH } from './run-context';

setup('login and persist storageState', async ({ page }) => {
  const email = process.env.PLAYWRIGHT_USER_EMAIL;
  const password = process.env.PLAYWRIGHT_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('PLAYWRIGHT_USER_EMAIL and PLAYWRIGHT_USER_PASSWORD must be set');
  }

  await page.goto(FRONTEND_BASE_URL);
  const result = await page.evaluate(
    async ({ api, email, password }) => {
      const response = await fetch(`${api}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        return { ok: false as const, detail: `${response.status} ${await response.text()}` };
      }
      return { ok: true as const };
    },
    { api: API_BASE_URL, email, password },
  );
  expect(result.ok, `login failed: ${result.ok ? 'ok' : result.detail}`).toBeTruthy();

  await page.context().storageState({ path: AUTH_STORAGE_PATH });
});
