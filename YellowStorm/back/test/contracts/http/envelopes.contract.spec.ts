import { expectContract } from '../expect-contract';

/**
 * Live HTTP envelope contracts, recorded against the running Mongo build
 * (CONTRACT_BASE_URL, default http://localhost:3001). They lock the global
 * success/error envelope shapes — success / 401 / 404 — that every migrated
 * module must keep byte-compatible. Skipped (not failed) when the backend is
 * unreachable, so offline runs stay green.
 */

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3001';

let up = false;
beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/api/v1/auth/providers`, { signal: AbortSignal.timeout(3000) });
    up = res.ok;
  } catch {
    up = false;
  }
  if (!up) console.warn(`[contracts] backend ${BASE} unreachable — HTTP envelope contracts skipped`);
});

async function get(pathname: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${pathname}`, { signal: AbortSignal.timeout(5000) });
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
    const { status, body } = await get('/api/v1/workspaces');
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
