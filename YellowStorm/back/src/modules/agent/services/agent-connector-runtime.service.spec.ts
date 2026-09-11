import { createVerify, generateKeyPairSync } from 'node:crypto';
import { AgentConnectorRuntimeService } from './agent-connector-runtime.service';

describe('AgentConnectorRuntimeService', () => {
  it('propagates connector action safety and defaults missing safety to unknown', async () => {
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn() } as never,
      {} as never,
      {} as never,
      { resolveRuntimeAuth: jest.fn() } as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([
      ['connector-1', {
        id: 'connector-1', name: 'CRM', slug: 'crm', actions: [
          { key: 'update', safety: 'WRITE', parameterSchema: {} },
          { key: 'read', parameterSchema: {} },
        ],
      } as never],
    ]), ['connector-1']);

    expect(bindings[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_key: 'update', safety: 'write' }),
      expect.objectContaining({ action_key: 'read', safety: 'unknown' }),
    ]));
  });

  it('injects a verifiable per-run agent JWT into the whatsapp MCP binding', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const configGet = jest.fn((key: string, fallback?: string) => {
      if (key === 'whatsappMcp.jwtPrivateKey') return privateKey;
      if (key === 'whatsappMcp.connectorSlug') return 'mcp-whatsapp';
      if (key === 'whatsappMcp.tokenTtlSeconds') return 300;
      if (key === 'MCP_LOGICAL_SEARCH_API_KEY') return 'shared-search-key';
      return fallback;
    });
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn() } as never,
      {} as never,
      {} as never,
      { resolveRuntimeAuth: jest.fn() } as never,
      { get: configGet } as never,
    );

    const bindings = await service.buildConnectorBindings(
      new Map([
        ['c-wa', {
          id: 'c-wa', name: 'WhatsApp Send', slug: 'mcp-whatsapp',
          mcpTransportType: 'streamable_http', actions: [{ key: 'send_whatsapp' }],
        } as never],
        ['c-search', {
          id: 'c-search', name: 'Search', slug: 'search',
          mcpTransportType: 'streamable_http', actions: [{ key: 'search' }],
        } as never],
      ]),
      ['c-wa', 'c-search'],
      'user-1',
      undefined,
      undefined,
      'agent-1',
    );

    const whatsappAuth = (bindings[0].auth_headers as Record<string, string>).Authorization;
    expect(whatsappAuth).toMatch(/^Bearer /);

    // The agent JWT wins over the generic search-key fallback.
    const [header, payload, signature] = whatsappAuth.slice('Bearer '.length).split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toMatchObject({
      agentId: 'agent-1',
      userId: 'user-1',
    });

    // Unrelated streamable_http connectors still receive the shared search key.
    expect((bindings[1].auth_headers as Record<string, string>).Authorization).toBe(
      'Bearer shared-search-key',
    );
  });

  it('skips agent JWT injection when no private key is configured', async () => {
    const configGet = jest.fn((_key: string, fallback?: string) => fallback);
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn() } as never,
      {} as never,
      {} as never,
      { resolveRuntimeAuth: jest.fn() } as never,
      { get: configGet } as never,
    );

    const bindings = await service.buildConnectorBindings(
      new Map([
        ['c-wa', {
          id: 'c-wa', name: 'WhatsApp Send', slug: 'mcp-whatsapp',
          mcpTransportType: 'streamable_http', actions: [{ key: 'send_whatsapp' }],
        } as never],
      ]),
      ['c-wa'],
      'user-1',
      undefined,
      undefined,
      'agent-1',
    );

    expect((bindings[0].auth_headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
