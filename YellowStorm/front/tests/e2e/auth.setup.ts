/**
 * Playwright auth setup. Runs once before the `chromium` project and
 * writes a `storageState` JSON that pre-populates the browser context
 * for every subsequent spec. The frontend's `AuthContext` reads the
 * JWT from `localStorage[AUTH_STORAGE_KEYS.accessToken]`, so the same
 * value must be written there.
 */
import { test as setup, expect } from '@playwright/test';
import { API_BASE_URL, FRONTEND_BASE_URL } from './fixtures';
import { AUTH_STORAGE_KEYS } from '../../src/lib/api/config';

const STORAGE_PATH = 'tests/e2e/.auth/storage-state.json';

setup('login and persist storageState', async ({ page, request }) => {
  const email = process.env.PLAYWRIGHT_USER_EMAIL;
  const password = process.env.PLAYWRIGHT_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('PLAYWRIGHT_USER_EMAIL and PLAYWRIGHT_USER_PASSWORD must be set');
  }

  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    headers: { 'content-type': 'application/json' },
    data: { email, password },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  const { data } = (await response.json()) as {
    data: { accessToken: string; user: { id: string; email: string } };
  };

  // Seed the same localStorage keys the frontend reads on boot. The
  // hash router sends us to the landing page; the auth provider
  // hydrates from these keys.
  await page.goto(FRONTEND_BASE_URL);
  await page.evaluate(
    ({ token, user, keys }) => {
      window.localStorage.setItem(keys.accessToken, token);
      window.localStorage.setItem(keys.user, JSON.stringify(user));
    },
    { token: data.accessToken, user: data.user, keys: AUTH_STORAGE_KEYS },
  );

  await page.context().storageState({ path: STORAGE_PATH });
});
