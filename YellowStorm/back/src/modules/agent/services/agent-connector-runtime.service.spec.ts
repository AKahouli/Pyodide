import { createVerify, generateKeyPairSync } from 'node:crypto';
import { AgentConnectorRuntimeService } from './agent-connector-runtime.service';

describe('AgentConnectorRuntimeService', () => {
  it('injects JWT and renewal metadata even when the connector has no saved credential', async () => {
    const mcpJwt = { bindingAuth: jest.fn().mockResolvedValue({
      headers: { Authorization: 'Bearer signed-jwt' },
      env: { YELLOWSTORM_MCP_JWT_CONNECTOR_ID: 'connector-1', YELLOWSTORM_MCP_JWT_USER_ID: 'acting-user' },
    }) };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never, {} as never,
      { resolveDynamicHeaders: jest.fn().mockResolvedValue({}) } as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, mcpJwt as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Semantic', authSourceType: 'none', mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://localhost:8027/mcp', actions: [{ key: 'find_records', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');
    expect(mcpJwt.bindingAuth).toHaveBeenCalledWith('http://localhost:8027/mcp', 'acting-user', 'connector-1', {}, {});
    expect(bindings[0].auth_headers).toEqual({ Authorization: 'Bearer signed-jwt' });
    expect(bindings[0].auth_env).toHaveProperty('YELLOWSTORM_MCP_JWT_USER_ID', 'acting-user');
  });
  it('defers configured workspace headers to the execution runtime', async () => {
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn() } as never,
      {} as never,
      {} as never,
      { resolveRuntimeAuth: jest.fn() } as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Search', slug: 'search', mcpTransportType: 'streamable_http', actions: [{ key: 'find', parameterSchema: {} }],
      dynamicHeaders: [
        { headerName: 'Workspace-Id', source: 'workspace', enabled: true },
        { headerName: 'X-Disabled', source: 'workspace', enabled: false },
        { headerName: 'X-User-Id', source: 'user_id', enabled: true },
      ],
    } as never]]), ['connector-1']);

    expect(bindings[0].dynamic_headers).toEqual([
      { header_name: 'Workspace-Id', source: 'workspace' },
    ]);
    expect(bindings[0].auth_headers).not.toHaveProperty('Workspace-Id');
  });

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
        id: 'connector-1', name: 'CRM', slug: 'crm', mcpTransportType: 'streamable_http', actions: [
          { key: 'update', safety: 'WRITE', executionKind: 'leaf', parameterSchema: {} },
          { key: 'read', parameterSchema: {} },
        ],
      } as never],
    ]), ['connector-1']);

    expect(bindings[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_key: 'update', safety: 'write', execution_kind: 'leaf' }),
      expect.objectContaining({ action_key: 'read', safety: 'unknown', execution_kind: 'leaf' }),
    ]));
  });

  it('propagates provider-neutral web result semantics', async () => {
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn() } as never,
      {} as never,
      {} as never,
      { resolveRuntimeAuth: jest.fn() } as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Search', slug: 'search', mcpTransportType: 'streamable_http', actions: [{
        key: 'find', parameterSchema: {}, resultKind: 'web_search', citationMode: 'text_fragment',
        resultMapping: { itemsPath: 'results', fields: { url: ['href'] } },
      }],
    } as never]]), ['connector-1']);

    expect(bindings[0].actions).toEqual([expect.objectContaining({
      result_kind: 'web_search', citation_mode: 'text_fragment',
      result_mapping_json: JSON.stringify({ itemsPath: 'results', fields: { url: ['href'] } }),
    })]);
  });

  it('never binds stored stdio or unknown transports, whatever actions they declare', async () => {
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn() } as never,
      {} as never,
      {} as never,
      { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) } as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([
      ['connector-stdio', {
        id: 'connector-stdio', name: 'Local', slug: 'local', mcpTransportType: 'stdio',
        mcpServerUrl: '/usr/local/bin/some-mcp', actions: [{ key: 'run', isEnabled: true }],
      } as never],
      ['connector-unknown', {
        id: 'connector-unknown', name: 'Weird', slug: 'weird', mcpTransportType: 'wat',
        mcpServerUrl: 'https://x/mcp', actions: [{ key: 'run', isEnabled: true }],
      } as never],
    ]), ['connector-stdio', 'connector-unknown']);

    expect(bindings).toEqual([]);
  });
});
