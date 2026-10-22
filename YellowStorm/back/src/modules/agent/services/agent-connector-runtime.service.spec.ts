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

  it('drops a connector that fails access validation while its siblings still bind', async () => {
    let rejectAccess!: (error: Error) => void;
    const accessGate = new Promise<void>((_resolve, reject) => { rejectAccess = reject; });
    const jwt = { assertConnectorAccess: jest.fn((connector: { id: string }) =>
      connector.id === 'denied' ? accessGate : Promise.resolve()),
      bindingAuth: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer signed-jwt' }, env: {} }) };
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
    await new Promise(setImmediate);
    expect(jwt.assertConnectorAccess).toHaveBeenCalledTimes(2);
    expect(jwt.bindingAuth).not.toHaveBeenCalled();
    rejectAccess(new Error('access denied'));
    const bindings = await pending;
    // The denied connector gets nothing; the allowed sibling still binds.
    expect(bindings.map((binding: Record<string, unknown>) => binding.connector_id)).toEqual(['allowed']);
    expect(jwt.bindingAuth).toHaveBeenCalledTimes(1);
    expect(jwt.bindingAuth).toHaveBeenCalledWith('https://allowed.example/mcp', 'acting-user', 'allowed', {}, {});
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
  it('carries the delegated provider credential alongside the assertion for a combined internal_jwt connector', async () => {
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { 'X-M365-Access-Token': 'graph-token' }, env: {},
      }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = {
      assertConnectorAccess: jest.fn().mockResolvedValue(undefined),
      bindingAuth: jest.fn((_url: string, _user: string, _id: string, existing: Record<string, string>) => Promise.resolve({
        headers: { ...existing, Authorization: 'Bearer signed-jwt' }, env: {},
      })),
    };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never, auth as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, mcpJwt as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'SharePoint', authSourceType: 'connected_app', connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' },
      mcpTransportType: 'streamable_http', mcpServerUrl: 'http://localhost:8100/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: true, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');

    expect(auth.resolveRuntimeAuth).toHaveBeenCalledWith('acting-user', expect.objectContaining({
      authSourceType: 'connected_app', connectedAppKey: 'microsoft', connectorId: 'connector-1',
    }));
    expect(mcpJwt.bindingAuth).toHaveBeenCalledWith('http://localhost:8100/mcp', 'acting-user', 'connector-1',
      { 'X-M365-Access-Token': 'graph-token' }, {});
    expect(bindings[0].auth_headers).toEqual({
      'X-M365-Access-Token': 'graph-token', Authorization: 'Bearer signed-jwt',
    });
  });

  it('denies an internal_jwt connector whose declared provider credential does not resolve', async () => {
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn() };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never, auth as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, mcpJwt as never,
    );
    // Unusable protected connectors are dropped (warn + no binding) instead of
    // failing the whole conversation; the connector never reaches the runtime.
    const dropped = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'SharePoint', authSourceType: 'connected_app', connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' },
      mcpTransportType: 'streamable_http', mcpServerUrl: 'http://localhost:8100/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: true, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');
    expect(dropped).toEqual([]);
    expect(mcpJwt.bindingAuth).not.toHaveBeenCalled();
    expect(auth.resolveDynamicHeaders).not.toHaveBeenCalled();
  });

  it('denies a provider credential delivered into the assertion-owned Authorization slot', async () => {
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer graph-token' }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn() };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never, auth as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, mcpJwt as never,
    );
    // A bearer credential defaulting to Authorization would survive this check
    // and then be overwritten by the assertion, emitting an assertion-only call.
    const dropped = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'SharePoint', authSourceType: 'connected_app', connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'Authorization', headerPrefix: 'Bearer ' },
      mcpTransportType: 'streamable_http', mcpServerUrl: 'http://localhost:8100/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: true, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');
    expect(dropped).toEqual([]);
    expect(mcpJwt.bindingAuth).not.toHaveBeenCalled();
  });

  it('denies a provider mapping that also puts the token in the assertion slot', async () => {
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer graph-token', 'X-Client-Id': 'yellowstorm' }, env: {},
      }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn() };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never, auth as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, mcpJwt as never,
    );
    // A metadata header must not stand in for the credential the assertion
    // overwrites: the token is dropped, leaving an assertion-only request.
    const dropped = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'SharePoint', authSourceType: 'server_config', connectedAppKey: '',
      mcpTransportType: 'streamable_http', mcpServerUrl: 'http://localhost:8100/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: true, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');
    expect(dropped).toEqual([]);
    expect(mcpJwt.bindingAuth).not.toHaveBeenCalled();
  });

  it('leaves an internal_jwt connector with no provider source untouched', async () => {
    const auth = { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn().mockResolvedValue({
      headers: { Authorization: 'Bearer signed-jwt' }, env: {},
    }) };
    const service = new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never, {} as never,
      { assertRuntimeDestination: jest.fn().mockResolvedValue(undefined) } as never, auth as never,
      { get: jest.fn((_key, fallback) => fallback) } as never, mcpJwt as never,
    );
    const bindings = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Playbook', authSourceType: 'none', mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://localhost:8025/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-playbook', actorDelegation: 'verified_user', allowPrivateNetwork: true, requiredPermissions: [] },
      actions: [{ key: 'search_playbooks', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');

    expect(auth.resolveRuntimeAuth).not.toHaveBeenCalled();
    expect(bindings[0].auth_headers).toEqual({ Authorization: 'Bearer signed-jwt' });
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
    const dropped = await service.buildConnectorBindings(new Map([['connector-1', {
      id: 'connector-1', name: 'Protected', authSourceType: 'connected_app', connectedAppKey: 'provider',
      mcpTransportType: 'streamable_http', mcpServerUrl: 'https://example.test/mcp',
      mcpServerConfig: { headers: { Authorization: 'Bearer forbidden-static-fallback' } },
      actions: [{ key: 'search', isEnabled: true }],
    } as never]]), ['connector-1'], 'acting-user');
    expect(dropped).toEqual([]);
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
        mcpSecurityPolicy: { version: 1, profile: 'public', actorDelegation: 'none', allowPrivateNetwork: false, requiredPermissions: [] },
      },
      {
        id: 'c-external', name: 'External', slug: 'external',
        actions: [{ key: 'do', isEnabled: true, parameterSchema: {} }],
        mcpServerUrl: 'https://third.party/mcp', mcpTransportType: 'streamable_http', authSourceType: 'none',
        mcpSecurityPolicy: { version: 1, profile: 'public', actorDelegation: 'none', allowPrivateNetwork: false, requiredPermissions: [] },
      },
    ];
    return new AgentConnectorRuntimeService(
      { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never,
      { findByIds: jest.fn() } as never,
      {
        findRuntimeByIds: jest.fn().mockResolvedValue(connectors),
        assertRuntimeDestination: jest.fn().mockResolvedValue(undefined),
      } as never,
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
