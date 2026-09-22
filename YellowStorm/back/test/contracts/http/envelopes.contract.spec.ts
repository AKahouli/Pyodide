import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expectContract } from '../expect-contract';

/**
 * Live HTTP envelope contracts, recorded against the running Mongo build
 * (CONTRACT_BASE_URL, default http://localhost:3001). They lock the global
 * success/error envelope shapes that every migrated module must keep
 * byte-compatible. Skipped (not failed) when the backend is unreachable, so
 * offline runs stay green.
 *
 * Authenticated routes need CONTRACT_TOKEN (or a recorder credential file at
 * ~/.yellowstorm-recorder.json); without a token those cases skip.
 */

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3001';

function recorderToken(): string | null {
  if (process.env.CONTRACT_TOKEN) return process.env.CONTRACT_TOKEN;
  const credPath = path.join(os.homedir(), '.yellowstorm-recorder.json');
  try {
    return JSON.parse(fs.readFileSync(credPath, 'utf8')).token ?? null;
  } catch {
    return null;
  }
}

let up = false;
let token: string | null = null;
beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/api/v1/auth/providers`, { signal: AbortSignal.timeout(3000) });
    up = res.ok;
  } catch {
    up = false;
  }
  if (!up) console.warn(`[contracts] backend ${BASE} unreachable — HTTP envelope contracts skipped`);
  token = recorderToken();
});

async function get(pathname: string, options: { auth?: boolean } = {}): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, { headers, signal: AbortSignal.timeout(5000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe('http envelope contracts', () => {
  it('auth/providers lists providers in the success envelope', async () => {
    if (!up) return;
    const { status, body } = await get('/api/v1/auth/providers');
    expect(status).toBe(200);
    expectContract('http/auth-providers', body);
  });

  it('health reports in the success envelope (503 allowed while degraded)', async () => {
    if (!up) return;
    const { status, body } = await get('/api/v1/health');
    expect([200, 503]).toContain(status);
    expectContract('http/health', body);
  });

  it('unauthenticated requests return the 401 error envelope', async () => {
    if (!up) return;
    const { status, body } = await get('/api/v1/workspaces', { auth: false });
    expect(status).toBe(401);
    expectContract('http/unauthorized', body);
  });

  it('unknown routes return the 404 error envelope', async () => {
    if (!up) return;
    const { status, body } = await get('/api/v1/__definitely_not_a_route__');
    expect(status).toBe(404);
    expectContract('http/not-found', body);
  });
});

describe('http identity route contracts (authenticated)', () => {
  it('users/me returns the profile envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/users/me');
    expect(status).toBe(200);
    expectContract('http/users-me', body);
  });

  it('users/search returns the search results envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/users/search?q=rec');
    expect(status).toBe(200);
    expectContract('http/users-search', body);
  });

  it('admin/users returns the paginated list envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/admin/users?page=1&limit=5');
    expect(status).toBe(200);
    expectContract('http/admin-users', body);
  });

  it('admin/roles returns the list envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/admin/roles');
    expect(status).toBe(200);
    expectContract('http/admin-roles', body);
  });

  it('admin/audit-logs returns the filtered list envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/admin/audit-logs');
    expect(status).toBe(200);
    expectContract('http/admin-audit-logs', body);
  });

  it('user-groups returns the list envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/user-groups');
    expect(status).toBe(200);
    expectContract('http/user-groups', body);
  });

  it('admin/auth-providers returns the list envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/admin/auth-providers');
    expect(status).toBe(200);
    expectContract('http/admin-auth-providers', body);
  });

  it('auth/sessions returns the session list envelope', async () => {
    if (!up || !token) return;
    const { status, body } = await get('/api/v1/auth/sessions');
    expect(status).toBe(200);
    expectContract('http/auth-sessions', body);
  });
});
