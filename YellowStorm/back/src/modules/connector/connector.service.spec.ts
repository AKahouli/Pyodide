import { ConnectorService } from './connector.service';
import { ConnectorActionSafety, DynamicHeaderSource } from './connector.types';
import type {
  ConnectorCategoryStore,
  ConnectorRow,
  ConnectorStore,
} from './persistence/connector.store';
import { SandboxRuntimeContext } from '../../common/runtime/sandbox-scope';

const createPlaybookBindingSyncServiceMock = () => ({
  syncConnectorActions: jest.fn().mockResolvedValue(undefined),
});

/** Deep-partial row override: lets fixture literals use minimal action/header objects. */
type RowOver = {
  [K in keyof ConnectorRow]?: ConnectorRow[K] extends Array<infer T>
    ? Array<Partial<T>>
    : ConnectorRow[K];
};

const baseRow = (over: RowOver = {}): ConnectorRow =>
  ({
    id: '507f1f77bcf86cd799439031',
    slug: 'github',
    name: 'GitHub',
    description: '',
    icon: '',
    color: '',
    iconColor: 'light',
    categoryId: null,
    authType: 'none',
    authConfigSchema: {},
    authSourceType: 'none',
    connectedAppKey: '',
    runtimeAuthConfig: {},
    mcpTransportType: 'streamable_http',
    mcpServerUrl: '',
    mcpServerConfig: {},
    dynamicHeaders: [],
    actions: [],
    skillIds: [],
    isActive: true,
    isSystem: false,
    isHidden: false,
    createdBy: '507f1f77bcf86cd799439032',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  }) as ConnectorRow;

const connectorStoreMock = (over: Record<string, jest.Mock> = {}): ConnectorStore =>
  ({
    findBySlugAndOwner: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    findActiveBySlug: jest.fn().mockResolvedValue(null),
    findByIds: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findAllActive: jest.fn().mockResolvedValue([]),
    findAllActiveVisible: jest.fn().mockResolvedValue([]),
    findNamesByIds: jest.fn().mockResolvedValue(new Map()),
    findIdsInCategories: jest.fn().mockResolvedValue([]),
    findImportSlugs: jest.fn().mockResolvedValue([]),
    insert: jest.fn(),
    findAllExport: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(null),
    findBySlugExcludingOwner: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
    upsertSystemActionsBySlug: jest.fn(),
    ...over,
  }) as unknown as ConnectorStore;

const categoryStoreMock = (over: Record<string, jest.Mock> = {}): ConnectorCategoryStore =>
  ({
    ensureSystem: jest.fn().mockResolvedValue(undefined),
    findByNameInsensitive: jest.fn().mockResolvedValue(null),
    findByOwnerName: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    insert: jest.fn(),
    update: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(true),
    findNamesByIds: jest.fn().mockResolvedValue(new Map()),
    findIdsByNameInsensitive: jest.fn().mockResolvedValue([]),
    ...over,
  }) as unknown as ConnectorCategoryStore;

describe('ConnectorService findAllActive', () => {
  it('includes hidden Playbook MCP while excluding other hidden connectors', async () => {
    const store = connectorStoreMock();
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
      null as any,
      null as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.findAllActive();

    // The active + visible filter (hidden excluded, playbook-mcp exception)
    // lives in the store port; the service pins the exception slug.
    expect(store.findAllActiveVisible).toHaveBeenCalledWith('playbook-mcp');
  });
});

describe('ConnectorService importFromMcp', () => {
  it('persists normalized actions when creating a connector', async () => {
    const store = connectorStoreMock({
      insert: jest.fn().mockResolvedValue(
        baseRow({
          slug: 'searchv2',
          name: 'SearchV2',
          description: 'Search connector',
          mcpServerUrl: 'https://example.com/mcp',
          skillIds: ['507f1f77bcf86cd799439033'],
        }),
      ),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    const response = await service.create('507f1f77bcf86cd799439034', {
      slug: 'searchv2',
      name: 'SearchV2',
      description: 'Search connector',
      mcpServerUrl: 'https://example.com/mcp',
      actions: [
        {
          key: 'search',
          label: 'Search',
          description: 'Unified search',
          parameterSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    });

    expect(store.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            key: 'search',
            label: 'Search',
            description: 'Unified search',
            parameterSchema: { type: 'object', properties: { query: { type: 'string' } } },
            outputSchema: {},
            safety: 'read',
            supportsBatch: false,
            supportsIteration: false,
            isEnabled: true,
          }),
        ],
      }),
    );
    // The response maps the store row's skillIds onto referencedSkillIds.
    expect(response.referencedSkillIds).toEqual(['507f1f77bcf86cd799439033']);
  });

  it('persists normalized actions when updating a connector', async () => {
    const connectorId = '507f1f77bcf86cd799439031';
    const store = connectorStoreMock({
      findById: jest.fn().mockResolvedValue(baseRow({ id: connectorId, slug: 'github' })),
      update: jest.fn().mockResolvedValue(
        baseRow({
          id: connectorId,
          slug: 'github',
          name: 'GitHub',
          description: 'GitHub MCP',
          authType: 'token',
          authSourceType: 'credential',
          actions: [{ key: 'get_me', label: 'Get Me' }],
        }),
      ),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.update(connectorId, {
      actions: [
        {
          key: 'get_me',
          label: 'Get Me',
          description: 'Return current GitHub user',
          parameterSchema: {},
          outputSchema: {},
          safety: ConnectorActionSafety.READ,
          supportsBatch: false,
          supportsIteration: false,
          isEnabled: true,
        },
      ],
    });

    expect(store.update).toHaveBeenCalledWith(
      connectorId,
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            key: 'get_me',
            label: 'Get Me',
            description: 'Return current GitHub user',
            parameterSchema: {},
            outputSchema: {},
            safety: 'read',
            supportsBatch: false,
            supportsIteration: false,
            isEnabled: true,
          }),
        ],
      }),
    );
  });

  it('syncs referenced playbook bindings when connector actions change', async () => {
    const connectorId = '507f1f77bcf86cd799439031';
    const store = connectorStoreMock({
      findById: jest.fn().mockResolvedValue(
        baseRow({
          id: connectorId,
          slug: 'github',
          actions: [
            { key: 'old_tool', parameterSchema: { properties: { oldArg: {} } }, isEnabled: true },
            { key: 'disabled_tool', parameterSchema: {}, isEnabled: true },
          ],
        }),
      ),
      update: jest.fn().mockResolvedValue(baseRow({ id: connectorId, slug: 'github', name: 'GitHub' })),
    });
    const playbookBindingSyncService = { syncConnectorActions: jest.fn().mockResolvedValue(undefined) };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      null as any,
      playbookBindingSyncService as any,
    );

    await service.update(connectorId, {
      actions: [
        {
          key: 'old_tool',
          label: 'Old Tool',
          description: '',
          parameterSchema: { properties: { newArg: {} } },
          outputSchema: {},
          safety: ConnectorActionSafety.READ,
          supportsBatch: false,
          supportsIteration: false,
          isEnabled: true,
        },
        {
          key: 'new_tool',
          label: 'New Tool',
          description: '',
          parameterSchema: {},
          outputSchema: {},
          safety: ConnectorActionSafety.READ,
          supportsBatch: false,
          supportsIteration: false,
          isEnabled: true,
        },
        {
          key: 'disabled_tool',
          label: 'Disabled Tool',
          description: '',
          parameterSchema: {},
          outputSchema: {},
          safety: ConnectorActionSafety.READ,
          supportsBatch: false,
          supportsIteration: false,
          isEnabled: false,
        },
      ],
    });

    expect(playbookBindingSyncService.syncConnectorActions).toHaveBeenCalledWith(
      connectorId,
      [
        { key: 'old_tool', parameterSchema: { properties: { oldArg: {} } } },
        { key: 'disabled_tool', parameterSchema: {} },
      ],
      [
        { key: 'old_tool', parameterSchema: { properties: { newArg: {} } } },
        { key: 'new_tool', parameterSchema: {} },
      ],
    );
  });

  it('does not fail connector updates when playbook binding sync fails', async () => {
    const connectorId = '507f1f77bcf86cd799439031';
    const store = connectorStoreMock({
      findById: jest.fn().mockResolvedValue(
        baseRow({
          id: connectorId,
          slug: 'github',
          actions: [{ key: 'old_tool', isEnabled: true }],
        }),
      ),
      update: jest.fn().mockResolvedValue(baseRow({ id: connectorId, slug: 'github', name: 'GitHub' })),
    });
    const playbookBindingSyncService = {
      syncConnectorActions: jest.fn().mockRejectedValue(new Error('sync failed')),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      null as any,
      playbookBindingSyncService as any,
    );

    const response = await service.update(connectorId, {
      actions: [
        {
          key: 'new_tool',
          label: 'New Tool',
          description: '',
          parameterSchema: {},
          outputSchema: {},
          safety: ConnectorActionSafety.READ,
          supportsBatch: false,
          supportsIteration: false,
          isEnabled: true,
        },
      ],
    });

    expect(response.id).toBe(connectorId);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to synchronize playbook connector action bindings after connector update',
      expect.objectContaining({ connectorId, error: 'sync failed' }),
    );
  });

  it('clears referenced skills when update payload provides an empty array', async () => {
    const connectorId = '507f1f77bcf86cd799439031';
    const store = connectorStoreMock({
      findById: jest.fn().mockResolvedValue(baseRow({ id: connectorId, slug: 'github' })),
      update: jest.fn().mockResolvedValue(baseRow({ id: connectorId, slug: 'github', name: 'GitHub' })),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      null as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.update(connectorId, {
      referencedSkillIds: [],
    });

    // The DTO's referencedSkillIds maps to the store row's skillIds.
    expect(store.update).toHaveBeenCalledWith(
      connectorId,
      expect.objectContaining({
        skillIds: [],
      }),
    );
  });

  it('truncates oversized action fields before persisting', async () => {
    const store = connectorStoreMock({
      insert: jest.fn().mockResolvedValue(
        baseRow({
          slug: 'github',
          name: 'GitHub',
          description: 'GitHub connector',
          mcpServerUrl: 'https://example.com/mcp',
        }),
      ),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.create('507f1f77bcf86cd799439034', {
      slug: 'github',
      name: 'GitHub',
      description: 'GitHub connector',
      mcpServerUrl: 'https://example.com/mcp',
      actions: [
        {
          key: 'k'.repeat(200),
          label: 'l'.repeat(200),
          description: 'd'.repeat(1200),
        },
      ],
    });

    expect(store.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            key: 'k'.repeat(128),
            label: 'l'.repeat(128),
            description: 'd'.repeat(1024),
          }),
        ],
      }),
    );
  });

  it('creates a new connector with a unique slug when the imported name already exists', async () => {
    const store = connectorStoreMock({
      findImportSlugs: jest
        .fn()
        .mockResolvedValue(['sharepoint', 'sharepoint-2']),
      insert: jest.fn().mockResolvedValue(baseRow({ slug: 'sharepoint-3', name: 'SharePoint (3)' })),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    jest.spyOn(service, 'inspectMcp').mockResolvedValue({
      serverName: 'SharePoint',
      tools: [
        {
          name: 'list_files',
          description: 'List files',
          inputSchema: { type: 'object' },
        },
      ],
    });

    const createdBy = '507f1f77bcf86cd799439034';
    const result = await service.importFromMcp(createdBy, 'streamable_http', 'https://example.com/mcp');

    expect(result.error).toBeUndefined();
    expect(store.findImportSlugs).toHaveBeenCalledWith(createdBy, 'sharepoint');
    expect(store.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'sharepoint-3',
        name: 'SharePoint (3)',
        mcpTransportType: 'streamable_http',
        mcpServerUrl: 'https://example.com/mcp',
        isActive: true,
      }),
    );
  });

  it('keeps the original name and slug for the first import', async () => {
    const store = connectorStoreMock({
      findImportSlugs: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockResolvedValue(baseRow({ slug: 'sharepoint', name: 'SharePoint' })),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    jest.spyOn(service, 'inspectMcp').mockResolvedValue({
      serverName: 'SharePoint',
      tools: [],
    });

    await service.importFromMcp('507f1f77bcf86cd799439034', 'streamable_http', 'https://example.com/mcp');

    expect(store.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'sharepoint',
        name: 'SharePoint',
      }),
    );
  });

  it('builds an authorization header from githubPat when inspecting GitHub MCP', () => {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      connectorStoreMock(),
      categoryStoreMock(),
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    const requestInit = (service as any).buildMcpRequestInit({
      githubPat: 'ghp_test_123',
    });

    expect(requestInit).toEqual({
      headers: {
        Authorization: 'Bearer ghp_test_123',
      },
    });
  });

  it('preserves explicit authorization headers from server config', () => {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      connectorStoreMock(),
      categoryStoreMock(),
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    const requestInit = (service as any).buildMcpRequestInit({
      headers: {
        Authorization: 'Bearer existing_token',
        'X-Test': '1',
      },
    });

    expect(requestInit).toEqual({
      headers: {
        Authorization: 'Bearer existing_token',
        'X-Test': '1',
      },
    });
  });
});

describe('ConnectorService findByIdsForGrpc', () => {
  const buildService = (connectorRow: ConnectorRow | null, auth: any) => {
    const store = connectorStoreMock({
      findByIds: jest.fn().mockResolvedValue(connectorRow ? [connectorRow] : []),
    });
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    return new ConnectorService(
      store,
      categoryStoreMock(),
      logger as any,
      null as any,
      auth as any,
      createPlaybookBindingSyncServiceMock() as any,
    );
  };

  it('maps a connector to the gRPC wire shape with resolved auth + JSON-string schema', async () => {
    const connectorId = '507f1f77bcf86cd799439031';
    const row = baseRow({
      id: connectorId,
      name: 'SharePoint',
      authType: 'oauth2',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://mcp-m365.example/',
      dynamicHeaders: [{ headerName: 'X-User-Email', source: DynamicHeaderSource.USER_EMAIL, enabled: true }],
      actions: [
        {
          key: 'search_files',
          label: 'Search Files',
          description: 'Search SharePoint',
          parameterSchema: { type: 'object', properties: { query: { type: 'string' } } },
          isEnabled: true,
        },
        { key: 'disabled_action', label: 'Nope', isEnabled: false },
      ],
      isActive: true,
    });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer TOKEN' },
        env: {},
      }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({ 'X-User-Email': 'a@b.c' }),
    };
    const service = buildService(row, auth);

    const [binding] = await service.findByIdsForGrpc([connectorId], 'user-1');

    expect(auth.resolveRuntimeAuth).toHaveBeenCalledWith('user-1', expect.objectContaining({ connectedAppKey: 'microsoft' }));
    expect(binding).toEqual({
      connector_id: connectorId,
      connector_name: 'SharePoint',
      mcp_transport_type: 'streamable_http',
      mcp_server_url: 'https://mcp-m365.example/',
      auth_headers: { Authorization: 'Bearer TOKEN', 'X-User-Email': 'a@b.c' },
      auth_env: {},
      mcp_server_config_json: '{}',
      actions: [
        {
          action_key: 'search_files',
          label: 'Search Files',
          description: 'Search SharePoint',
          parameter_schema_json: '{"type":"object","properties":{"query":{"type":"string"}}}',
          result_kind: 'generic',
          citation_mode: 'none',
          result_mapping_json: '{}',
        },
      ],
    });
  });

  it('resolves auth for a credential-source connector, passing connectorId', async () => {
    const connectorId = '507f1f77bcf86cd799439035';
    const row = baseRow({
      id: connectorId,
      name: 'Code Interpreter',
      authSourceType: 'credential',
      connectedAppKey: '',
      runtimeAuthConfig: { strategy: 'http_header_bearer' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://ci/mcp',
      actions: [{ key: 'run', label: 'Run', isEnabled: true }],
      isActive: true,
    });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer SAVED' }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const service = buildService(row, auth);

    const [binding] = await service.findByIdsForGrpc([connectorId], 'user-1');

    expect(auth.resolveRuntimeAuth).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ authSourceType: 'credential', connectorId }),
    );
    expect(binding.auth_headers).toEqual({ Authorization: 'Bearer SAVED' });
  });

  it('drops connectors that have no enabled action', async () => {
    const connectorId = '507f1f77bcf86cd799439036';
    const row = baseRow({
      id: connectorId,
      name: 'Empty',
      authSourceType: 'none',
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://x/',
      actions: [{ key: 'a', label: 'a', isEnabled: false }],
      isActive: true,
    });
    const auth = { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const service = buildService(row, auth);

    const bindings = await service.findByIdsForGrpc([connectorId], 'user-1');
    expect(bindings).toEqual([]);
    expect(auth.resolveRuntimeAuth).not.toHaveBeenCalled();
  });

  it('forwards mcpServerConfig (e.g. the linkup/code-interpreter gateway auth header) as a JSON string', async () => {
    // Regression test: worky's gRPC servicer parses mcp_server_config_json to
    // recover this connector's own MCP-gateway auth (separate from the
    // per-user auth_headers above). A typed protobuf Struct silently
    // serializes to {} over @grpc/proto-loader, so this has to travel as a
    // string -- dropping this field means every linkup/code-interpreter call
    // goes out unauthenticated (401) instead of failing loudly.
    const connectorId = '507f1f77bcf86cd799439037';
    const row = baseRow({
      id: connectorId,
      name: 'Linkup',
      authSourceType: 'none',
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://linkup-mcp.example/',
      mcpServerConfig: { headers: { Authorization: 'Bearer GATEWAY_TOKEN' } },
      actions: [{ key: 'search', label: 'Search', isEnabled: true }],
      isActive: true,
    });
    const auth = { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const service = buildService(row, auth);

    const [binding] = await service.findByIdsForGrpc([connectorId], 'user-1');

    expect(binding.mcp_server_config_json).toBe(
      JSON.stringify({ headers: { Authorization: 'Bearer GATEWAY_TOKEN' } }),
    );
  });

  describe('sandbox scope injection', () => {
    const ctx: SandboxRuntimeContext = {
      userId: 'user-1',
      scopeType: 'conversation',
      scopeId: 'conversation:sess-1',
      laneId: 'main',
    };
    const noAuth = {
      resolveRuntimeAuth: jest.fn(),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const ciRow = () =>
      baseRow({
        id: '507f1f77bcf86cd799439038',
        name: 'Code Interpreter',
        slug: 'code-interpreter',
        authSourceType: 'none',
        mcpTransportType: 'streamable_http',
        mcpServerUrl: 'https://ci/mcp',
        actions: [{ key: 'run', label: 'Run', isEnabled: true }],
        isActive: true,
      });

    it('stamps x-sandbox-* onto a code-interpreter connector when ctx is provided', async () => {
      const row = ciRow();
      const service = buildService(row, { ...noAuth });

      const [binding] = await service.findByIdsForGrpc([row.id], 'user-1', ctx);

      expect(binding.auth_headers['x-sandbox-scope-id']).toBe('conversation:sess-1');
      expect(binding.auth_headers['x-sandbox-scope-type']).toBe('conversation');
      expect(binding.auth_headers['x-sandbox-lane-id']).toBe('main');
      expect(binding.auth_headers['x-user-id']).toBe('user-1');
    });

    it('does not stamp a non-code-interpreter connector', async () => {
      const row = { ...ciRow(), name: 'Gmail', slug: 'gmail' };
      const service = buildService(row, { ...noAuth });

      const [binding] = await service.findByIdsForGrpc([row.id], 'user-1', ctx);

      expect(binding.auth_headers['x-sandbox-scope-id']).toBeUndefined();
    });

    it('is unchanged when ctx is omitted (regression guard)', async () => {
      const row = ciRow();
      const service = buildService(row, { ...noAuth });

      const [binding] = await service.findByIdsForGrpc([row.id], 'user-1');

      expect(binding.auth_headers['x-sandbox-scope-id']).toBeUndefined();
    });
  });
});

describe('ConnectorService findIdsByCategoryName', () => {
  it('returns active connector ids assigned to the named category', async () => {
    const connectorId = '507f1f77bcf86cd799439039';
    const categoryId = '507f1f77bcf86cd799439040';
    const store = connectorStoreMock({
      findIdsInCategories: jest.fn().mockResolvedValue([connectorId]),
    });
    const categoryStore = categoryStoreMock({
      findIdsByNameInsensitive: jest.fn().mockResolvedValue([categoryId]),
    });
    const service = new ConnectorService(
      store,
      categoryStore,
      { setContext: jest.fn() } as any,
      null as any,
      {} as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await expect(service.findIdsByCategoryName([connectorId], 'Web Search'))
      .resolves.toEqual([connectorId]);
    expect(categoryStore.findIdsByNameInsensitive).toHaveBeenCalledWith('Web Search');
    expect(store.findIdsInCategories).toHaveBeenCalledWith([connectorId], [categoryId]);
  });
});
