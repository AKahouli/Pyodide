/**
 * Shared Playwright fixtures and constants for the Worky smoke suite.
 *
 * Tests run in a single worker (`fullyParallel: false`) and share the
 * authenticated `storageState` produced by `auth.setup.ts`. Each spec
 * creates a fresh Worky stream via the REST API so test data does not
 * leak between specs.
 */
import { test as base, expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

export const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:3000/api/v1';
export const FRONTEND_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export interface AuthSession {
  accessToken: string;
  userId: string;
}

export interface WorkyStreamFixture {
  id: string;
  title: string;
  managerModelId: string | null;
  workerModelId: string | null;
  status: string;
}

async function readJson<T>(response: APIResponse): Promise<T> {
  const body = (await response.json()) as { data: T };
  return body.data;
}

async function loginAs(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<AuthSession> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    headers: { 'content-type': 'application/json' },
    data: { email, password },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  const payload = await readJson<{ accessToken: string; user: { id: string } }>(response);
  return { accessToken: payload.accessToken, userId: payload.user.id };
}

export async function createWorkyStream(
  request: APIRequestContext,
  accessToken: string,
  title: string,
  body: Partial<Pick<WorkyStreamFixture, 'managerModelId' | 'workerModelId' | 'status'>> = {},
): Promise<WorkyStreamFixture> {
  const response = await request.post(`${API_BASE_URL}/worky/streams`, {
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    data: { title, ...body },
  });
  expect(response.ok(), `createStream failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return readJson<WorkyStreamFixture>(response);
}

export async function patchWorkyStream(
  request: APIRequestContext,
  accessToken: string,
  streamId: string,
  body: Partial<Pick<WorkyStreamFixture, 'managerModelId' | 'workerModelId' | 'status'>>,
): Promise<WorkyStreamFixture> {
  const response = await request.patch(`${API_BASE_URL}/worky/streams/${streamId}`, {
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    data: body,
  });
  expect(response.ok(), `patchStream failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return readJson<WorkyStreamFixture>(response);
}

export async function deleteWorkyStream(
  request: APIRequestContext,
  accessToken: string,
  streamId: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE_URL}/worky/streams/${streamId}/delete`, {
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
  });
  expect(response.ok(), `deleteStream failed: ${response.status()} ${await response.text()}`).toBeTruthy();
}

export const workyTest = base.extend<{
  authed: AuthSession;
  freshStream: WorkyStreamFixture;
}>({
  authed: async ({ request }, use) => {
    const email = process.env.PLAYWRIGHT_USER_EMAIL;
    const password = process.env.PLAYWRIGHT_USER_PASSWORD;
    if (!email || !password) {
      throw new Error(
        'PLAYWRIGHT_USER_EMAIL and PLAYWRIGHT_USER_PASSWORD must be set to run the smoke suite',
      );
    }
    const session = await loginAs(request, email, password);
    await use(session);
  },
  freshStream: async ({ request, authed }, use) => {
    const stream = await createWorkyStream(request, authed.accessToken, `playwright-${Date.now()}`);
    try {
      await use(stream);
    } finally {
      await deleteWorkyStream(request, authed.accessToken, stream.id);
    }
  },
});

export type WorkyFixtures = {
  authed: AuthSession;
  freshStream: WorkyStreamFixture;
  page: Page;
};
