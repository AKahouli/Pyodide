import { assertNoUrlCredentials, sanitizeEndpointUrl, sanitizeMcpPublicMetadata } from './remote-mcp-transport.util';

describe('R03 MCP endpoint input and public projection', () => {
  const canary = 'TEST_CANARY_R03';

  it.each([
    `https://mcp.example.test/mcp?token=${canary}`,
    `https://mcp.example.test/mcp?SiG=${encodeURIComponent(canary)}`,
    `https://mcp.example.test/mcp?%74oken=${canary}`,
    'https://mcp.example.test/mcp?',
    `https://mcp.example.test/mcp#${canary}`,
    `https://user:${canary}@mcp.example.test/mcp`,
    'not-an-endpoint',
    'https://mcp.example.test/%ZZ',
    'https://mcp.example.test/%FF',
    'https://mcp.example.test/%E2%82',
    `https://mcp.example.test/%3ftoken%3d${canary}`,
  ])('rejects unsafe new endpoints without echoing the supplied value', (endpoint) => {
    let failure: unknown;
    try { assertNoUrlCredentials(endpoint); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(JSON.stringify(failure)).not.toContain(canary);
  });

  it.each([
    [`https://user:${canary}@mcp.example.test:443/mcp?token=${canary}#private`, 'https://mcp.example.test/mcp'],
    ['HTTP://MCP.EXAMPLE.TEST:80/mcp?route=private', 'http://mcp.example.test/mcp'],
    ['https://mcp.example.test/mcp', 'https://mcp.example.test/mcp'],
    ['not-an-endpoint?token=secret', ''],
    ['javascript:alert(1)', ''],
    ['https://mcp.example.test/%ZZ', ''],
    ['https://mcp.example.test/%FF', ''],
    ['https://mcp.example.test/%E2%82', ''],
    [`https://mcp.example.test/%3ftoken%3d${canary}`, ''],
  ])('projects %s without userinfo, query, fragment or invalid-input fallback', (endpoint, expected) => {
    expect(sanitizeEndpointUrl(endpoint)).toBe(expected);
    expect(sanitizeEndpointUrl(endpoint)).not.toContain(canary);
  });

  it('allows an absent endpoint for a non-MCP connector', () => {
    expect(() => assertNoUrlCredentials('')).not.toThrow();
    expect(sanitizeEndpointUrl(undefined)).toBe('');
  });

  it('removes endpoint secrets copied into nested metadata, keys and encoded strings', () => {
    const endpoint = `https://mcp.example.test/mcp?token=${canary}`;
    const value = { description: `Imported from ${endpoint}`, schema: {
      properties: { query: { description: `private ${canary}`, default: canary } },
      [canary]: { hidden: canary },
    }, actions: [{ description: `See https://other.example.test/mcp?arbitrary=${canary}` }] };
    const result = sanitizeMcpPublicMetadata(value, endpoint);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result.description).toBe('Imported from https://mcp.example.test/mcp');
    expect(result.schema.properties.query.default).toBe('[redacted]');
    expect(value.schema.properties.query.default).toBe(canary);
    const fullyEncoded = [...canary].map(char => `%${char.charCodeAt(0).toString(16)}`).join('');
    expect(sanitizeMcpPublicMetadata({ description: fullyEncoded }, endpoint).description).toBe('[redacted]');
    expect(sanitizeMcpPublicMetadata({ description: `${fullyEncoded}%ZZ` }, endpoint).description).toBe('[redacted]');
    expect(sanitizeMcpPublicMetadata({ description: `${fullyEncoded}%FF` }, endpoint).description).toBe('[redacted]');
    expect(sanitizeMcpPublicMetadata({ description: `${fullyEncoded}%E2%82` }, endpoint).description).toBe('[redacted]');
    const malformed = `not-an-endpoint?token=${canary}`;
    expect(JSON.stringify(sanitizeMcpPublicMetadata({ description: malformed, nested: { default: canary } }, malformed)))
      .not.toContain(canary);
    expect(JSON.stringify(sanitizeMcpPublicMetadata({ description: canary }, `https://user:${canary}@[invalid/mcp`)))
      .not.toContain(canary);
  });
});
