import { isTrustedMcpServerUrl, normalizeMcpServerUrl, trustedMcpServerUrls } from './trusted-mcp-server.util';

function configWith(values: Record<string, string>) {
  return {
    get: <T = string>(key: string, fallback?: T): T | undefined =>
      (values[key] as unknown as T | undefined) ?? fallback,
  };
}

describe('trusted-mcp-server.util', () => {
  it('normalizes case and trailing slashes', () => {
    expect(normalizeMcpServerUrl(' HTTP://Localhost:8027/MCP/ ')).toBe('http://localhost:8027/mcp');
  });

  it('trusts the configured pyodide MCP server URL', () => {
    const config = configWith({ PYODIDE_MCP_SERVER_URL: 'http://localhost:8027/mcp' });
    expect(isTrustedMcpServerUrl(config, 'http://localhost:8027/mcp/')).toBe(true);
  });

  it('never trusts a third-party server that only shares a prefix', () => {
    const config = configWith({ PYODIDE_MCP_SERVER_URL: 'http://localhost:8027/mcp' });
    expect(isTrustedMcpServerUrl(config, 'https://third.party/mcp')).toBe(false);
    expect(isTrustedMcpServerUrl(config, 'http://localhost:8027/mcp/extra')).toBe(false);
  });

  it('includes comma-separated TRUSTED_MCP_SERVER_URLS', () => {
    const config = configWith({ TRUSTED_MCP_SERVER_URLS: 'http://a/mcp, http://b/mcp' });
    expect(trustedMcpServerUrls(config)).toEqual(new Set(['http://a/mcp', 'http://b/mcp']));
  });
});
