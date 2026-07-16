import { Types } from 'mongoose';
import { ConnectorService } from './connector.service';
import { ConnectorActionSafety } from './schemas/connector.schema';

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
});
