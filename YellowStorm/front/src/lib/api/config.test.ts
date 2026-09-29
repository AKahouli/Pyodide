import { afterEach, describe, expect, it, vi } from 'vitest';

const PUBLIC = 'https://poc.back.yellowmind.ai/api/v1';
const LOOPBACK = 'http://localhost:3000/api/v1';

async function loadConfig() {
  vi.resetModules();
  return import('./config');
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__APP_CONFIG__;
});

describe('resolveApiBaseUrl', () => {
  it('uses runtime config from /config.js first', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl(PUBLIC, LOOPBACK, false)).toBe(PUBLIC);
  });

  it('lets runtime config override a wrong inlined build arg', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl(PUBLIC, 'http://localhost:9999/api/v1', false)).toBe(PUBLIC);
  });

  it('falls back to VITE_API_URL when runtime config is empty', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('', PUBLIC, false)).toBe(PUBLIC);
  });

  it('treats a blank runtime value as absent', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('   ', PUBLIC, false)).toBe(PUBLIC);
  });

  it('returns empty string in production when nothing is configured', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('', '', false)).toBe('');
  });

  it('defaults dev to loopback when nothing is configured', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('', '', true)).toBe(LOOPBACK);
  });

  it('trims surrounding whitespace from both sources', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl(`  ${PUBLIC}  `, '', false)).toBe(PUBLIC);
    expect(resolveApiBaseUrl('', `  ${PUBLIC}  `, false)).toBe(PUBLIC);
  });

  it('supports root-relative API URLs', async () => {
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl('/api/v1', '', false)).toBe('/api/v1');
  });

  it('reads window.__APP_CONFIG__.API_URL by default', async () => {
    window.__APP_CONFIG__ = { API_URL: 'https://runtime.example.com/api/v1' };
    const { resolveApiBaseUrl } = await loadConfig();
    expect(resolveApiBaseUrl()).toBe('https://runtime.example.com/api/v1');
  });
});

describe('isValidApiUrl & isApiConfigured', () => {
  it('identifies valid and invalid API URLs', async () => {
    const { isValidApiUrl } = await loadConfig();
    expect(isValidApiUrl('https://api.example.com/api/v1')).toBe(true);
    expect(isValidApiUrl('/api/v1')).toBe(true);
    expect(isValidApiUrl('')).toBe(false);
    expect(isValidApiUrl(null)).toBe(false);
  });

  it('reports configured status from baseURL', async () => {
    vi.stubEnv('VITE_API_URL', PUBLIC);
    const { isApiConfigured } = await loadConfig();
    expect(isApiConfigured()).toBe(true);
  });
});

describe('getSocketBaseUrl', () => {
  it('resolves socket origin from window.__APP_CONFIG__.SOCKET_BASE_URL', async () => {
    window.__APP_CONFIG__ = { SOCKET_BASE_URL: 'https://socket.example.com:8443' };
    const { getSocketBaseUrl } = await loadConfig();
    expect(getSocketBaseUrl()).toBe('https://socket.example.com:8443');
  });
});

describe('API_CONFIG.baseURL', () => {
  it('picks up VITE_API_URL from the build environment', async () => {
    vi.stubEnv('VITE_API_URL', PUBLIC);
    const { API_CONFIG } = await loadConfig();
    expect(API_CONFIG.baseURL).toBe(PUBLIC);
  });
});
