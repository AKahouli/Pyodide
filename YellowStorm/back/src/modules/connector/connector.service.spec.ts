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
      logger as any,
      null as any,
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
      logger as any,
      null as any,
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
      logger as any,
      null as any,
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
      logger as any,
      null as any,
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
      logger as any,
      null as any,
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
      logger as any,
      null as any,
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
