import { Types } from 'mongoose';
import { ConnectorService } from './connector.service';
import { ConnectorActionSafety } from './schemas/connector.schema';
import { SandboxRuntimeContext } from '../../common/runtime/sandbox-scope';

const createPlaybookBindingSyncServiceMock = () => ({
  syncConnectorActions: jest.fn().mockResolvedValue(undefined),
});

describe('ConnectorService Playbook MCP reconciliation', () => {
  it('persists Google ADK-compatible string enums', async () => {
    const connectorId = new Types.ObjectId();
    const findOneAndUpdate = jest.fn().mockImplementation((_filter, update) => ({
      exec: jest.fn().mockResolvedValue({
        _id: connectorId,
        slug: 'playbook-mcp',
        ...update.$setOnInsert,
        ...update.$set,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    }));
    const service = new ConnectorService(
      { findOneAndUpdate } as any,
      { find: jest.fn() } as any,
      { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
      null as any,
      null as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.reconcilePlaybookMcpSystemConnector(new Types.ObjectId().toString(), 'http://localhost:8025/mcp');

    const actions = findOneAndUpdate.mock.calls[0][1].$set.actions;
    const recent = actions.find((action: { key: string }) => action.key === 'list_recent_executions');
    expect(recent.parameterSchema.properties.status).toEqual({
      type: 'string',
      enum: ['running', 'failed', 'completed', 'waiting', 'cancelled'],
    });
  });
});

describe('ConnectorService findAllActive', () => {
  it('includes hidden Playbook MCP while excluding other hidden connectors', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const lean = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ lean });
    const find = jest.fn().mockReturnValue({ sort });
    const service = new ConnectorService(
      { find } as any,
      { find: jest.fn() } as any,
      { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
      null as any,
      null as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.findAllActive();

    expect(find).toHaveBeenCalledWith({
      isActive: true,
      $or: [
        { isHidden: { $ne: true } },
        { slug: 'playbook-mcp' },
      ],
    });
  });
});

describe('ConnectorService importFromMcp', () => {
  it('persists normalized actions when creating a connector', async () => {
    const create = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      slug: 'searchv2',
      name: 'SearchV2',
      description: 'Search connector',
      icon: '',
      color: '',
      authType: 'none',
      authConfigSchema: {},
      authSourceType: 'none',
      connectedAppKey: '',
      runtimeAuthConfig: {},
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.com/mcp',
      mcpServerConfig: {},
      actions: [],
      referencedSkillIds: [],
      isActive: true,
      createdBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        create,
        findOne,
      } as any,
      { find: jest.fn() } as any,
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.create(new Types.ObjectId().toString(), {
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

    expect(create).toHaveBeenCalledWith(
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
  });

  it('persists normalized actions when updating a connector', async () => {
    const connectorId = new Types.ObjectId().toString();
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: connectorId,
          slug: 'github',
          createdBy: new Types.ObjectId(),
        }),
      }),
    });
    const findByIdAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: connectorId,
          slug: 'github',
          name: 'GitHub',
          description: 'GitHub MCP',
          icon: '',
          color: '',
          authType: 'token',
          authConfigSchema: {},
          authSourceType: 'credential',
          connectedAppKey: '',
          runtimeAuthConfig: {},
          mcpTransportType: 'streamable_http',
          mcpServerUrl: 'https://example.com/mcp',
          mcpServerConfig: {},
          actions: [
            {
              key: 'get_me',
              label: 'Get Me',
            },
          ],
          referencedSkillIds: [],
          isActive: true,
          createdBy: new Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        findById,
        findByIdAndUpdate,
        findOne: jest.fn(),
      } as any,
      { find: jest.fn() } as any,
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

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      connectorId,
      {
        $set: expect.objectContaining({
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
      },
      { new: true },
    );
  });

  it('syncs referenced playbook bindings when connector actions change', async () => {
    const connectorId = new Types.ObjectId().toString();
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: connectorId,
          slug: 'github',
          createdBy: new Types.ObjectId(),
          actions: [
            { key: 'old_tool', parameterSchema: { properties: { oldArg: {} } }, isEnabled: true },
            { key: 'disabled_tool', parameterSchema: {}, isEnabled: true },
          ],
        }),
      }),
    });
    const findByIdAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: connectorId,
          slug: 'github',
          name: 'GitHub',
          description: 'GitHub MCP',
          icon: '',
          color: '',
          authType: 'token',
          authConfigSchema: {},
          authSourceType: 'credential',
          connectedAppKey: '',
          runtimeAuthConfig: {},
          mcpTransportType: 'streamable_http',
          mcpServerUrl: 'https://example.com/mcp',
          mcpServerConfig: {},
          actions: [],
          referencedSkillIds: [],
          isActive: true,
          createdBy: new Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      }),
    });
    const playbookBindingSyncService = { syncConnectorActions: jest.fn().mockResolvedValue(undefined) };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const service = new ConnectorService(
      { findById, findByIdAndUpdate, findOne: jest.fn() } as any,
      { find: jest.fn() } as any,
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
    const connectorId = new Types.ObjectId().toString();
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: connectorId,
          slug: 'github',
          createdBy: new Types.ObjectId(),
          actions: [{ key: 'old_tool', isEnabled: true }],
        }),
      }),
    });
    const updatedConnector = {
      _id: connectorId,
      slug: 'github',
      name: 'GitHub',
      description: 'GitHub MCP',
      icon: '',
      color: '',
      authType: 'token',
      authConfigSchema: {},
      authSourceType: 'credential',
      connectedAppKey: '',
      runtimeAuthConfig: {},
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.com/mcp',
      mcpServerConfig: {},
      actions: [],
      referencedSkillIds: [],
      isActive: true,
      createdBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findByIdAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedConnector),
      }),
    });
    const playbookBindingSyncService = {
      syncConnectorActions: jest.fn().mockRejectedValue(new Error('sync failed')),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const service = new ConnectorService(
      { findById, findByIdAndUpdate, findOne: jest.fn() } as any,
      { find: jest.fn() } as any,
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
    const connectorId = new Types.ObjectId().toString();
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: connectorId,
          slug: 'github',
          createdBy: new Types.ObjectId(),
        }),
      }),
    });
    const findByIdAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: connectorId,
          slug: 'github',
          name: 'GitHub',
          description: 'GitHub MCP',
          icon: '',
          color: '',
          authType: 'token',
          authConfigSchema: {},
          authSourceType: 'credential',
          connectedAppKey: '',
          runtimeAuthConfig: {},
          mcpTransportType: 'streamable_http',
          mcpServerUrl: 'https://example.com/mcp',
          mcpServerConfig: {},
          actions: [],
          referencedSkillIds: [],
          isActive: true,
          createdBy: new Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        findById,
        findByIdAndUpdate,
        findOne: jest.fn(),
      } as any,
      { find: jest.fn() } as any,
      logger as any,
      null as any,
      null as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.update(connectorId, {
      referencedSkillIds: [],
    });

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      connectorId,
      {
        $set: expect.objectContaining({
          referencedSkillIds: [],
        }),
      },
      { new: true },
    );
  });

  it('truncates oversized action fields before persisting', async () => {
    const create = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      slug: 'github',
      name: 'GitHub',
      description: 'GitHub connector',
      icon: '',
      color: '',
      authType: 'none',
      authConfigSchema: {},
      authSourceType: 'none',
      connectedAppKey: '',
      runtimeAuthConfig: {},
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.com/mcp',
      mcpServerConfig: {},
      actions: [],
      referencedSkillIds: [],
      isActive: true,
      createdBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        create,
        findOne,
      } as any,
      { find: jest.fn() } as any,
      logger as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    await service.create(new Types.ObjectId().toString(), {
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

    expect(create).toHaveBeenCalledWith(
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
    const create = jest.fn().mockResolvedValue({});
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { slug: 'sharepoint', name: 'SharePoint' },
            { slug: 'sharepoint-2', name: 'SharePoint (2)' },
          ]),
        }),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        create,
        find,
      } as any,
      { find: jest.fn() } as any,
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

    const createdBy = new Types.ObjectId().toString();
    const result = await service.importFromMcp(createdBy, 'streamable_http', 'https://example.com/mcp');

    expect(result.error).toBeUndefined();
    expect(find).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
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
    const create = jest.fn().mockResolvedValue({});
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        create,
        find,
      } as any,
      { find: jest.fn() } as any,
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

    await service.importFromMcp(new Types.ObjectId().toString(), 'streamable_http', 'https://example.com/mcp');

    expect(create).toHaveBeenCalledWith(
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
      {
        create: jest.fn(),
        find: jest.fn(),
      } as any,
      { find: jest.fn() } as any,
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
      {
        create: jest.fn(),
        find: jest.fn(),
      } as any,
      { find: jest.fn() } as any,
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
  const buildService = (connectorDoc: any, auth: any) => {
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(connectorDoc ? [connectorDoc] : []),
        }),
      }),
    });
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    return new ConnectorService(
      { find } as any,
      { find: jest.fn() } as any,
      logger as any,
      null as any,
      auth as any,
      createPlaybookBindingSyncServiceMock() as any,
    );
  };

  it('maps a connector to the gRPC wire shape with resolved auth + JSON-string schema', async () => {
    const doc = {
      _id: new Types.ObjectId(),
      name: 'SharePoint',
      authType: 'oauth2',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://mcp-m365.example/',
      dynamicHeaders: [{ headerName: 'X-User-Email', source: 'user_email', enabled: true }],
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
    };
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer TOKEN' },
        env: {},
      }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({ 'X-User-Email': 'a@b.c' }),
    };
    const service = buildService(doc, auth);

    const [binding] = await service.findByIdsForGrpc([doc._id.toString()], 'user-1');

    expect(auth.resolveRuntimeAuth).toHaveBeenCalledWith('user-1', expect.objectContaining({ connectedAppKey: 'microsoft' }));
    expect(binding).toEqual({
      connector_id: doc._id.toString(),
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
        },
      ],
    });
  });

  it('resolves auth for a credential-source connector, passing connectorId', async () => {
    const doc = {
      _id: new Types.ObjectId(),
      name: 'Code Interpreter',
      authSourceType: 'credential',
      connectedAppKey: '',
      runtimeAuthConfig: { strategy: 'http_header_bearer' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://ci/mcp',
      actions: [{ key: 'run', label: 'Run', isEnabled: true }],
      isActive: true,
    };
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer SAVED' }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const service = buildService(doc, auth);

    const [binding] = await service.findByIdsForGrpc([doc._id.toString()], 'user-1');

    expect(auth.resolveRuntimeAuth).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ authSourceType: 'credential', connectorId: doc._id.toString() }),
    );
    expect(binding.auth_headers).toEqual({ Authorization: 'Bearer SAVED' });
  });

  it('drops connectors that have no enabled action', async () => {
    const doc = {
      _id: new Types.ObjectId(),
      name: 'Empty',
      authSourceType: 'none',
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://x/',
      actions: [{ key: 'a', label: 'a', isEnabled: false }],
      isActive: true,
    };
    const auth = { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const service = buildService(doc, auth);

    const bindings = await service.findByIdsForGrpc([doc._id.toString()], 'user-1');
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
    const doc = {
      _id: new Types.ObjectId(),
      name: 'Linkup',
      authSourceType: 'none',
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://linkup-mcp.example/',
      mcpServerConfig: { headers: { Authorization: 'Bearer GATEWAY_TOKEN' } },
      actions: [{ key: 'search', label: 'Search', isEnabled: true }],
      isActive: true,
    };
    const auth = { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const service = buildService(doc, auth);

    const [binding] = await service.findByIdsForGrpc([doc._id.toString()], 'user-1');

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
    const ciDoc = () => ({
      _id: new Types.ObjectId(),
      name: 'Code Interpreter',
      slug: 'code-interpreter',
      authSourceType: 'none',
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://ci/mcp',
      actions: [{ key: 'run', label: 'Run', isEnabled: true }],
      isActive: true,
    });

    it('stamps x-sandbox-* onto a code-interpreter connector when ctx is provided', async () => {
      const doc = ciDoc();
      const service = buildService(doc, { ...noAuth });

      const [binding] = await service.findByIdsForGrpc([doc._id.toString()], 'user-1', ctx);

      expect(binding.auth_headers['x-sandbox-scope-id']).toBe('conversation:sess-1');
      expect(binding.auth_headers['x-sandbox-scope-type']).toBe('conversation');
      expect(binding.auth_headers['x-sandbox-lane-id']).toBe('main');
      expect(binding.auth_headers['x-user-id']).toBe('user-1');
    });

    it('does not stamp a non-code-interpreter connector', async () => {
      const doc = { ...ciDoc(), name: 'Gmail', slug: 'gmail' };
      const service = buildService(doc, { ...noAuth });

      const [binding] = await service.findByIdsForGrpc([doc._id.toString()], 'user-1', ctx);

      expect(binding.auth_headers['x-sandbox-scope-id']).toBeUndefined();
    });

    it('is unchanged when ctx is omitted (regression guard)', async () => {
      const doc = ciDoc();
      const service = buildService(doc, { ...noAuth });

      const [binding] = await service.findByIdsForGrpc([doc._id.toString()], 'user-1');

      expect(binding.auth_headers['x-sandbox-scope-id']).toBeUndefined();
    });
  });
});
