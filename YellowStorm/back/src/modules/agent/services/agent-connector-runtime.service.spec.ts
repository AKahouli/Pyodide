import { createVerify, generateKeyPairSync } from 'node:crypto';
import { AgentConnectorRuntimeService } from './agent-connector-runtime.service';

describe('AgentConnectorRuntimeService', () => {
  it('defers configured workspace headers to the execution runtime', async () => {
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn() } as never,
      {} as never,
      {} as never,
      { resolveRuntimeAuth: jest.fn() } as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Search', slug: 'search', actions: [{ key: 'find', parameterSchema: {} }],
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
        id: 'connector-1', name: 'CRM', slug: 'crm', actions: [
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
      id: 'connector-1', name: 'Search', slug: 'search', actions: [{
        key: 'find', parameterSchema: {}, resultKind: 'web_search', citationMode: 'text_fragment',
        resultMapping: { itemsPath: 'results', fields: { url: ['href'] } },
      }],
    } as never]]), ['connector-1']);

    expect(bindings[0].actions).toEqual([expect.objectContaining({
      result_kind: 'web_search', citation_mode: 'text_fragment',
      result_mapping_json: JSON.stringify({ itemsPath: 'results', fields: { url: ['href'] } }),
    })]);
  });
});

describe('AgentConnectorRuntimeService trusted identity propagation', () => {
  const userId = '65f000000000000000000001';
  const trustedUrl = 'http://localhost:8027/mcp';

  function buildService(): AgentConnectorRuntimeService {
    const connectors = [
      {
        id: 'c-pyodide', name: 'Pyodide', slug: 'pyodide',
        actions: [{
          key: 'execute_python', isEnabled: true,
          parameterSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
        }],
        mcpServerUrl: trustedUrl, mcpTransportType: 'streamable_http', authSourceType: 'none',
      },
      {
        id: 'c-external', name: 'External', slug: 'external',
        actions: [{ key: 'do', isEnabled: true, parameterSchema: {} }],
        mcpServerUrl: 'https://third.party/mcp', mcpTransportType: 'streamable_http', authSourceType: 'none',
      },
    ];
    return new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never,
      { findByIds: jest.fn() } as never,
      { findByIds: jest.fn().mockResolvedValue(connectors) } as never,
      { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) } as never,
      { get: jest.fn((key: string, fallback: string) => (key === 'PYODIDE_MCP_SERVER_URL' ? trustedUrl : fallback)) } as never,
    );
  }

  it('adds the acting user to trusted internal MCP bindings only', async () => {
    const result = await buildService().buildGrpcConnectorRuntimeForPlaybook(userId, [
      { connectorId: 'c-pyodide', actions: [{ actionKey: 'execute_python', isEnabled: true }] },
      { connectorId: 'c-external', actions: [{ actionKey: 'do', isEnabled: true }] },
    ]);

    const trusted = result.connector_bindings.find((binding) => binding.connector_slug === 'pyodide');
    const external = result.connector_bindings.find((binding) => binding.connector_slug === 'external');
    expect(trusted?.auth_headers).toMatchObject({ 'X-YellowStorm-User-Id': userId });
    expect(external?.auth_headers ?? {}).not.toHaveProperty('X-YellowStorm-User-Id');
  });

  it('never exposes the trusted identity as a model-visible tool argument', async () => {
    const result = await buildService().buildGrpcConnectorRuntimeForPlaybook(userId, [
      { connectorId: 'c-pyodide', actions: [{ actionKey: 'execute_python', isEnabled: true }] },
    ]);

    const action = (result.connector_bindings[0].actions as Array<Record<string, unknown>>)[0];
    const schema = JSON.parse(String(action.parameter_schema_json)) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(['code']);
    expect(JSON.stringify(action)).not.toContain('X-YellowStorm');
  });
});
