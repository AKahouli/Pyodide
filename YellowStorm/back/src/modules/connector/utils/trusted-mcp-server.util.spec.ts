import { jwtCapableMcpServerUrls, trustedMcpServerUrls } from './trusted-mcp-server.util';

const config = (values: Record<string, string>) => ({
  get: <T = string>(key: string, fallback?: T): T | undefined => (values[key] as T) ?? fallback,
});

describe('trusted MCP server endpoint selection (WP05.5)', () => {
  it('lists only JWT-mode service URLs as egress exceptions', () => {
    const urls = jwtCapableMcpServerUrls(config({
      PLAYBOOK_MCP_SERVER_URL: 'http://localhost:8025/mcp',
      AGENT_MCP_SERVER_URL: 'http://localhost:8026/mcp',
      SEMANTIC_MODEL_MCP_SERVER_URL: 'http://localhost:8027/mcp',
      PLAYBOOK_MCP_AUTH_MODE: 'JWT',
      AGENT_MCP_AUTH_MODE: 'Bearer',
      SEMANTIC_MODEL_MCP_AUTH_MODE: 'JWT',
    }));

    expect(urls).toEqual(['http://localhost:8025/mcp', 'http://localhost:8027/mcp']);
  });

  it('lists nothing when every service runs Bearer mode', () => {
    expect(jwtCapableMcpServerUrls(config({
      PLAYBOOK_MCP_SERVER_URL: 'http://localhost:8025/mcp',
      SEMANTIC_MODEL_MCP_SERVER_URL: 'http://localhost:8027/mcp',
    }))).toEqual([]);
  });

  it('keeps TRUSTED_MCP_SERVER_URLS out of the egress exception (identity-header trust only)', () => {
    // Trusted-by-URL servers receive identity headers, but they are not
    // necessarily JWT-signed; the egress exception requires service-issued
    // JWTs, so the shared list never widens it.
    const values = {
      TRUSTED_MCP_SERVER_URLS: 'http://localhost:8099/mcp,http://localhost:9000/mcp',
      SEMANTIC_MODEL_MCP_AUTH_MODE: 'JWT',
      SEMANTIC_MODEL_MCP_SERVER_URL: 'http://localhost:8027/mcp',
    };
    expect(trustedMcpServerUrls(config(values)).has('http://localhost:8099/mcp')).toBe(true);
    expect(jwtCapableMcpServerUrls(config(values))).toEqual(['http://localhost:8027/mcp']);
  });
});
