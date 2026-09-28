import { afterEach, describe, expect, it, vi } from 'vitest';

const PUBLIC = 'https://poc.back.yellowmind.ai/api/v1';
const LOOPBACK = 'http://localhost:3000/api/v1';

async function loadConfig() {
  vi.resetModules();
  return import('./config');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveApiBaseUrl', () => {
  it('uses the URL env.sh injected at container start', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl(PUBLIC, LOOPBACK, false)).toBe(PUBLIC);
  });

  it('lets runtime injection override a wrong inlined build arg', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl(PUBLIC, 'http://localhost:9999/api/v1', false)).toBe(PUBLIC);
  });

  it('falls back to the build arg when the placeholder was not rewritten', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('MY_APP_VITE_API_URL', PUBLIC, false)).toBe(PUBLIC);
  });

  it('treats a blank injected value as absent instead of an empty base URL', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    // `MY_APP_VITE_API_URL=${SOME_UNSET_VAR}` in compose expands to an empty string.
    expect(resolveApiBaseUrl('   ', PUBLIC, false)).toBe(PUBLIC);
  });

  it('keeps the placeholder when production has no configuration at all', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('MY_APP_VITE_API_URL', '', false)).toBe('MY_APP_VITE_API_URL');
  });

  it('defaults dev to loopback when nothing is configured', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('MY_APP_VITE_API_URL', '', true)).toBe(LOOPBACK);
  });

  it('trims surrounding whitespace from both sources', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl(`  ${PUBLIC}  `, '', false)).toBe(PUBLIC);
    expect(resolveApiBaseUrl('MY_APP_VITE_API_URL', `  ${PUBLIC}  `, false)).toBe(PUBLIC);
  });
});

describe('API_CONFIG.baseURL', () => {
  it('picks up VITE_API_URL from the build environment', async () => {
    vi.stubEnv('VITE_API_URL', PUBLIC);
    const { API_CONFIG } = await loadConfig();
    expect(API_CONFIG.baseURL).toBe(PUBLIC);
  });
});
