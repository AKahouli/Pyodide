import { createVerify, generateKeyPairSync } from 'node:crypto';
import { AgentConnectorRuntimeService } from './agent-connector-runtime.service';

describe('AgentConnectorRuntimeService', () => {
  it('resolves independent connectors concurrently without reordering bindings or bypassing the validation barrier', async () => {
    let releaseDestinations!: () => void;
    const destinationGate = new Promise<void>((resolve) => { releaseDestinations = resolve; });
    const destinations = jest.fn().mockReturnValue(destinationGate);
    const jwtReleases = new Map<string, (value: { headers: Record<string, string>; env: Record<string, string> }) => void>();
    const jwt = {
      assertConnectorAccess: jest.fn().mockResolvedValue(undefined),
      bindingAuth: jest.fn((_url: string, _user: string, id: string) => new Promise((resolve) => {
        jwtReleases.set(id, resolve);
      })),
    };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: destinations } as never, {} as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, jwt as never,
    );
    const ids = ['connector-1', 'connector-2', 'connector-3'];
    const connectors = new Map(ids.map((id) => [id, {
      id, name: id, mcpTransportType: 'streamable_http', mcpServerUrl: `https://${id}.example/mcp`,
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: id, actorDelegation: 'verified_user', allowPrivateNetwork: false, requiredPermissions: [] },
      actions: [{ key: 'read', isEnabled: true }],
    } as never]));
    const pending = service.buildConnectorBindings(connectors, ids, 'acting-user');
    expect(destinations).toHaveBeenCalledTimes(3);
    expect(jwt.assertConnectorAccess).not.toHaveBeenCalled();
    expect(jwt.bindingAuth).not.toHaveBeenCalled();
    releaseDestinations();
    await new Promise(setImmediate);
    expect(jwt.assertConnectorAccess).toHaveBeenCalledTimes(3);
    expect(jwt.bindingAuth).toHaveBeenCalledTimes(3);
    for (const id of [...ids].reverse()) jwtReleases.get(id)!({ headers: { Authorization: `Bearer ${id}` }, env: {} });
    const bindings = await pending;
    expect(bindings.map((binding) => binding.connector_id)).toEqual(ids);
    expect(bindings.map((binding) => binding.auth_headers)).toEqual(ids.map((id) => ({ Authorization: `Bearer ${id}` })));
    expect(jwt.bindingAuth.mock.calls.every((call) => call[1] === 'acting-user')).toBe(true);
  });

  it('does not mint any binding JWT when another concurrent connector fails access validation', async () => {
    let rejectAccess!: (error: Error) => void;
    const accessGate = new Promise<void>((_resolve, reject) => { rejectAccess = reject; });
    const jwt = { assertConnectorAccess: jest.fn((connector: { id: string }) =>
      connector.id === 'denied' ? accessGate : Promise.resolve()), bindingAuth: jest.fn() };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never, {} as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, jwt as never,
    );
    const connectors = new Map(['allowed', 'denied'].map((id) => [id, {
      id, name: id, mcpTransportType: 'streamable_http', mcpServerUrl: `https://${id}.example/mcp`,
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: id, actorDelegation: 'verified_user', allowPrivateNetwork: false, requiredPermissions: [] },
      actions: [{ key: 'read', isEnabled: true }],
    } as never]));
    const pending = service.buildConnectorBindings(connectors, ['allowed', 'denied'], 'acting-user');
    const rejected = expect(pending).rejects.toThrow('access denied');
    await new Promise(setImmediate);
    expect(jwt.assertConnectorAccess).toHaveBeenCalledTimes(2);
    expect(jwt.bindingAuth).not.toHaveBeenCalled();
    rejectAccess(new Error('access denied'));
    await rejected;
    expect(jwt.bindingAuth).not.toHaveBeenCalled();
  });

  it('injects JWT and renewal metadata even when the connector has no saved credential', async () => {
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn().mockResolvedValue({
      headers: { Authorization: 'Bearer signed-jwt' },
      env: { YELLOWSTORM_MCP_JWT_CONNECTOR_ID: 'connector-1' },
    }) };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never, { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never,
      { resolveDynamicHeaders: jest.fn().mockResolvedValue({}) } as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, mcpJwt as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Semantic', authSourceType: 'none', mcpTransportType: 'streamable_http',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-semantic-model', actorDelegation: 'verified_user', allowPrivateNetwork: true, requiredPermissions: [] },
      mcpServerUrl: 'http://localhost:8027/mcp', actions: [{ key: 'find_records', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');
    expect(mcpJwt.bindingAuth).toHaveBeenCalledWith('http://localhost:8027/mcp', 'acting-user', 'connector-1', {}, {});
    expect(bindings[0].auth_headers).toEqual({ Authorization: 'Bearer signed-jwt' });
    expect(bindings[0].auth_env).toEqual({ YELLOWSTORM_MCP_JWT_CONNECTOR_ID: 'connector-1' });
  });
  it.each(['missing', 'revoked', 'failed'])('denies %s configured auth before dynamic trace headers or JWT binding', async failure => {
    const auth = { resolveRuntimeAuth: failure === 'failed' ? jest.fn().mockRejectedValue(new Error('revoked credential'))
      : jest.fn().mockResolvedValue({ headers: {}, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({ 'X-User-Id': 'acting-user', 'X-Correlation-ID': 'trace' }) };
    const jwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn() };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never, auth as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, jwt as never);
    await expect(service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Protected', authSourceType: 'connected_app', connectedAppKey: 'provider',
      mcpTransportType: 'streamable_http', mcpServerUrl: 'https://example.test/mcp',
      mcpServerConfig: { headers: { Authorization: 'Bearer forbidden-static-fallback' } },
      actions: [{ key: 'search', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user')).rejects.toThrow(failure === 'failed' ? 'revoked credential' : 'no usable credential');
    expect(auth.resolveDynamicHeaders).not.toHaveBeenCalled();
    expect(jwt.bindingAuth).not.toHaveBeenCalled();
  });

  it('accepts explicit saved custom Authorization without inventing a connected-account credential', async () => {
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never,
      { resolveDynamicHeaders: jest.fn().mockResolvedValue({}) } as never,
      { get: jest.fn((_key, fallback) => fallback) } as never);
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Saved', authSourceType: 'none', mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.test/mcp', mcpServerConfig: { headers: { Authorization: 'Bearer saved-custom' } },
      actions: [{ key: 'search', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');
    expect(bindings[0].mcp_server_config).toEqual({ headers: { Authorization: 'Bearer saved-custom' } });
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
