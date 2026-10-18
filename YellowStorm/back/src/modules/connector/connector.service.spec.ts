import { ConnectorService, mcpToolSafety } from './connector.service';
import { ConnectorActionSafety, ConnectorAuthSourceType, DynamicHeaderSource } from './connector.types';
import { BadRequestException, ErrorCode } from '../exceptions';
import * as childProcess from 'node:child_process';
import type {
  ConnectorCategoryStore,
  ConnectorRow,
  ConnectorStore,
} from './persistence/connector.store';
import { SandboxRuntimeContext } from '../../common/runtime/sandbox-scope';
import { PgConnectorStore, PgConnectorCategoryStore } from './persistence/pg-connector.store';
import { RESERVED_SYSTEM_OWNER_ID } from '../agent/constants/platform-copilot.constants';
import { McpDestinationPolicyError } from './utils/mcp-destination-policy.util';
import { Permissions } from '../authorization/constants/permissions';

const assertMcpDestinationAllowed = jest.fn<Promise<string[]>, [string]>();

// The policy util's own behavior has a dedicated spec; the service spec stubs
// resolution so inspection tests stay hermetic, and overrides it per-test to
// prove the denial wiring (WP-05).
jest.mock('./utils/mcp-destination-policy.util', () => ({
  ...jest.requireActual('./utils/mcp-destination-policy.util'),
  assertMcpDestinationAllowed: (...args: unknown[]) => assertMcpDestinationAllowed(...(args as [string])),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue({
      tools: [
        {
          name: 'list_files',
          description: 'Lists files',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true },
        },
      ],
    }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const createPlaybookBindingSyncServiceMock = () => ({
  syncConnectorActions: jest.fn().mockResolvedValue(undefined),
});

/** Deep-partial row override: lets fixture literals use minimal action/header objects. */
type RowOver = {
  [K in keyof ConnectorRow]?: ConnectorRow[K] extends (infer T)[]
    ? Partial<T>[]
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
    securityRevision: 1,
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

const connectorStoreMock = (over: Record<string, jest.Mock> = {}): PgConnectorStore =>
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
  }) as unknown as PgConnectorStore;

const categoryStoreMock = (over: Record<string, jest.Mock> = {}): PgConnectorCategoryStore =>
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
  }) as unknown as PgConnectorCategoryStore;

describe('ConnectorService findAllActive', () => {
  it('lists active visible connectors only, with no slug exception', async () => {
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

    expect(store.findAllActiveVisible).toHaveBeenCalledWith();
  });
});

describe('mcpToolSafety', () => {
  it("reads a tool's MCP annotations: read-only, destructive, another change, or read when none are declared", () => {
    expect(mcpToolSafety({ readOnlyHint: true })).toBe('read');
    expect(mcpToolSafety({ readOnlyHint: false, destructiveHint: true })).toBe('delete');
    expect(mcpToolSafety({ readOnlyHint: false, destructiveHint: false })).toBe('write');
    expect(mcpToolSafety({ readOnlyHint: false })).toBe('write');
    expect(mcpToolSafety(undefined)).toBe('read');
    expect(mcpToolSafety({ title: 'x' })).toBe('read');
  });
});

describe('ConnectorService security write contract', () => {
  const policy = { version: 1 as const, profile: 'configured' as const, actorDelegation: 'none' as const,
    allowPrivateNetwork: true, allowInsecureHttp: false, requiredPermissions: [Permissions.CONNECTORS_READ] };
  const setup = (row = baseRow({ mcpSecurityPolicy: policy, mcpServerUrl: 'https://example.com/mcp' })) => {
    const store = connectorStoreMock({ findById: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue(row) });
    const service = new ConnectorService(store, categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as never, null as never, null as never,
      createPlaybookBindingSyncServiceMock() as never);
    return { store, service, row };
  };

  it.each([
    { mcpSecurityPolicy: { ...policy, requiredPermissions: [] }, expectedSecurityRevision: 1 },
    { mcpServerUrl: 'https://attacker.example/mcp', expectedSecurityRevision: 1 },
    { isActive: true, expectedSecurityRevision: 1 },
  ])('denies privileged mutation without management permission (%j)', async patch => {
    const { service, store, row } = setup(baseRow({ mcpSecurityPolicy: policy, isActive: false }));
    await expect(service.update(row.id, patch, [Permissions.CONNECTORS_UPDATE])).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    expect(store.update).not.toHaveBeenCalled();
  });

  it('preserves grants and stored credentials on ordinary metadata updates', async () => {
    const { service, store, row } = setup();
    await service.update(row.id, { name: 'Renamed' }, [Permissions.CONNECTORS_UPDATE]);
    expect(store.update).toHaveBeenCalledWith(row.id, { name: 'Renamed' });
    expect(row.mcpSecurityPolicy).toEqual(policy);
  });
  it('requires explicit clearing of saved credentials when transitioning to public', async () => {
    const { service, store, row } = setup(baseRow({
      mcpSecurityPolicy: policy, authSourceType: 'credential',
      runtimeAuthConfig: { strategy: 'http_header_bearer' },
      mcpServerConfig: { headers: { Authorization: 'Bearer stored' } },
    }));
    const patch = { mcpSecurityPolicy: { version: 1 as const, profile: 'public' as const,
      actorDelegation: 'none' as const, allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] },
      authSourceType: ConnectorAuthSourceType.NONE, expectedSecurityRevision: 1 };
    await expect(service.update(row.id, patch, [Permissions.CONNECTORS_SECURITY_MANAGE])).rejects.toThrow('cannot inject');
    expect(store.update).not.toHaveBeenCalled();
    await service.update(row.id, { ...patch, mcpServerConfig: {}, clearRuntimeAuthConfig: true }, [Permissions.CONNECTORS_SECURITY_MANAGE]);
    expect(store.update).toHaveBeenCalledWith(row.id, {
      mcpSecurityPolicy: patch.mcpSecurityPolicy, authSourceType: 'none', mcpServerConfig: {}, runtimeAuthConfig: {},
    }, 1);
  });

  it.each([undefined, 0, 2])('rejects missing/stale security revision %s before persistence', async expectedSecurityRevision => {
    const { service, store, row } = setup();
    await expect(service.update(row.id, { mcpServerUrl: 'https://new.example/mcp', expectedSecurityRevision },
      [Permissions.CONNECTORS_SECURITY_MANAGE])).rejects.toThrow('reload before saving');
    expect(store.update).not.toHaveBeenCalled();
  });

  it('fences authorized destination changes with the expected revision', async () => {
    const { service, store, row } = setup();
    await service.update(row.id, { mcpServerUrl: 'https://new.example/mcp', expectedSecurityRevision: 1 }, [Permissions.CONNECTORS_SECURITY_MANAGE]);
    expect(store.update).toHaveBeenCalledWith(row.id, { mcpServerUrl: 'https://new.example/mcp' }, 1);
  });

  it.each([
    { mcpServerConfig: { headers: { 'X-YellowStorm-User-Id': 'victim' } } },
    { runtimeAuthConfig: { envMap: { YELLOWSTORM_MCP_JWT_USER_ID: 'victim' } } },
    { dynamicHeaders: [{ headerName: 'X-YellowStorm-Mcp-Assertion', source: DynamicHeaderSource.USER_ID, enabled: true }] },
  ])('rejects reserved raw/dynamic identity overrides even for security managers (%j)', async patch => {
    const { service, store, row } = setup();
    await expect(service.update(row.id, { ...patch, expectedSecurityRevision: 1 }, [Permissions.CONNECTORS_SECURITY_MANAGE]))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(store.update).not.toHaveBeenCalled();
  });

  it('derives the exact private-network exception only from saved connector policy', async () => {
    const { service, row } = setup();
    assertMcpDestinationAllowed.mockResolvedValue([]);
    await service.assertRuntimeDestination(row);
    expect(assertMcpDestinationAllowed).toHaveBeenLastCalledWith(row.mcpServerUrl,
      expect.objectContaining({ allowExactEndpoints: [row.mcpServerUrl] }));
    await service.assertRuntimeDestination({ ...row, mcpSecurityPolicy: { ...policy, allowPrivateNetwork: false } });
    expect(assertMcpDestinationAllowed).toHaveBeenLastCalledWith(row.mcpServerUrl,
      expect.objectContaining({ allowExactEndpoints: [] }));
  });

  it('derives the development-only insecure HTTP grant from saved connector policy', async () => {
    const { service, row } = setup();
    assertMcpDestinationAllowed.mockResolvedValue([]);
    await service.assertRuntimeDestination(row);
    expect(assertMcpDestinationAllowed).toHaveBeenLastCalledWith(row.mcpServerUrl,
      expect.objectContaining({ allowInsecureHttp: false }));
    await service.assertRuntimeDestination({ ...row, mcpSecurityPolicy: { ...policy, allowInsecureHttp: true } });
    expect(assertMcpDestinationAllowed).toHaveBeenLastCalledWith(row.mcpServerUrl,
      expect.objectContaining({ allowInsecureHttp: true }));
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
  it.each(['missing', 'revoked', 'failed'])('rejects %s connected-account auth without trace or static-header fallback', async failure => {
    const row = baseRow({ authSourceType: 'connected_app', connectedAppKey: 'provider',
      mcpServerUrl: 'https://example.test/mcp', mcpServerConfig: { headers: { Authorization: 'Bearer forbidden-fallback' } },
      actions: [{ key: 'search', isEnabled: true }] });
    const auth = { resolveRuntimeAuth: failure === 'failed' ? jest.fn().mockRejectedValue(new Error('credential revoked'))
      : jest.fn().mockResolvedValue({ headers: {}, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({ 'X-User-Id': 'user', 'X-Correlation-ID': 'trace' }) };
    const service = buildService(row, auth);
    await expect(service.findByIdsForGrpc([row.id], 'user-1')).rejects.toThrow();
    expect(auth.resolveDynamicHeaders).not.toHaveBeenCalled();
  });

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

  it('carries a delegated provider credential alongside the assertion for a combined internal_jwt connector', async () => {
    const connectorId = '507f1f77bcf86cd799439041';
    const row = baseRow({
      id: connectorId,
      name: 'SharePoint',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://localhost:8100/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: true, allowInsecureHttp: true, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { 'X-M365-Access-Token': 'graph-token' }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = {
      assertConnectorAccess: jest.fn().mockResolvedValue(undefined),
      bindingAuth: jest.fn((_url: string, _user: string, _id: string, headers: Record<string, string>, env: Record<string, string>) =>
        Promise.resolve({ headers: { ...headers, Authorization: 'Bearer assertion' }, env })),
    };
    const store = connectorStoreMock({ findByIds: jest.fn().mockResolvedValue([row]) });
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const service = new ConnectorService(
      store, categoryStoreMock(), logger as any, null as any, auth as any,
      createPlaybookBindingSyncServiceMock() as any, null as any, mcpJwt as any,
    );

    const [binding] = await service.findByIdsForGrpc([connectorId], 'user-1');

    expect(mcpJwt.bindingAuth).toHaveBeenCalledWith('http://localhost:8100/mcp', 'user-1', connectorId,
      { 'X-M365-Access-Token': 'graph-token' }, {});
    expect(binding.auth_headers).toEqual({ 'X-M365-Access-Token': 'graph-token', Authorization: 'Bearer assertion' });
  });

  it('drops an internal_jwt binding when the declared provider credential cannot resolve', async () => {
    const connectorId = '507f1f77bcf86cd799439042';
    const row = baseRow({
      id: connectorId,
      name: 'SharePoint',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://localhost:8100/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: true, allowInsecureHttp: true, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn() };
    const store = connectorStoreMock({ findByIds: jest.fn().mockResolvedValue([row]) });
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const service = new ConnectorService(
      store, categoryStoreMock(), logger as any, null as any, auth as any,
      createPlaybookBindingSyncServiceMock() as any, null as any, mcpJwt as any,
    );

    await expect(service.findByIdsForGrpc([connectorId], 'user-1')).rejects.toThrow('no usable provider credential');
    expect(mcpJwt.bindingAuth).not.toHaveBeenCalled();
    expect(auth.resolveDynamicHeaders).not.toHaveBeenCalled();
  });

  it('drops an internal_jwt binding whose provider credential only fills the assertion slot', async () => {
    const connectorId = '507f1f77bcf86cd799439045';
    const row = baseRow({
      id: connectorId,
      name: 'SharePoint',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'Authorization', headerPrefix: 'Bearer ' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://localhost:8100/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: true, allowInsecureHttp: true, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer graph-token' }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), bindingAuth: jest.fn() };
    const store = connectorStoreMock({ findByIds: jest.fn().mockResolvedValue([row]) });
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const service = new ConnectorService(
      store, categoryStoreMock(), logger as any, null as any, auth as any,
      createPlaybookBindingSyncServiceMock() as any, null as any, mcpJwt as any,
    );

    await expect(service.findByIdsForGrpc([connectorId], 'user-1')).rejects.toThrow('no usable provider credential');
    expect(mcpJwt.bindingAuth).not.toHaveBeenCalled();
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
        mcpSecurityPolicy: { version: 1, profile: 'public', actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] },
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

describe('ConnectorService MCP inspection transport guard (SEC-01 / WP-01)', () => {
  beforeEach(() => {
    // Default: destinations pass the egress policy so inspection tests reach
    // the (mocked) MCP SDK; individual WP-05 tests override this.
    assertMcpDestinationAllowed.mockReset();
    assertMcpDestinationAllowed.mockResolvedValue(['93.184.216.34']);
  });

  const buildInspectionService = () => {
    const store = connectorStoreMock();
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );
    return { service, store };
  };

  it.each([
    ['stdio'],
    [''],
    ['UNKNOWN'],
    ['streamable-http'],
    ['sse;rm -rf'],
    [undefined as unknown as string],
  ])('denies transport "%s" with a 400 before any process spawn or network I/O', async (transportType) => {
    const spawnSpy = jest.spyOn(childProcess, 'spawn');
    const execSpy = jest.spyOn(childProcess, 'exec');
    const execFileSpy = jest.spyOn(childProcess, 'execFile');
    const { service, store } = buildInspectionService();

    await expect(service.inspectMcp(transportType, 'node server.js', { commandArgs: ['--evil'] }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(store.findById).not.toHaveBeenCalled();
    spawnSpy.mockRestore();
    execSpy.mockRestore();
    execFileSpy.mockRestore();
  });

  it('denies a stored stdio connector on every inspection entry point shape', async () => {
    const { service } = buildInspectionService();

    await expect(service.inspectMcp('stdio', '/usr/local/bin/some-mcp', { commandArgs: ['--stdio'] }, 'user-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importFromMcp('user-1', 'stdio', '/usr/local/bin/some-mcp'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports the transport denial before URL-credential validation on import', async () => {
    const { service } = buildInspectionService();
    const canary = 'import-url-canary-2b8f';

    // Unsupported transport + credential-bearing URL: the deterministic
    // ERR_3102 transport denial wins; no raw URL validation error escapes.
    const denial = service.importFromMcp('user-1', 'stdio', `https://user:${canary}@mcp.example.test/mcp`);
    await expect(denial).rejects.toBeInstanceOf(BadRequestException);
    await expect(denial).rejects.toMatchObject({ code: ErrorCode.CONNECTOR_MCP_TRANSPORT_UNSUPPORTED });
    try {
      await denial;
    } catch (err) {
      expect((err as Error).message).not.toContain(canary);
    }

    // A supported transport with a credential-bearing URL is still rejected,
    // now deterministically (400), and never reaches the network.
    await expect(service.importFromMcp('user-1', 'sse', `https://user:${canary}@mcp.example.test/sse`))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('inspects a combined internal_jwt connector with both the provider credential and the assertion', async () => {
    const row = baseRow({
      id: '507f1f77bcf86cd799439043',
      name: 'SharePoint',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://mcp-sharepoint.example.test/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    });
    const store = connectorStoreMock({ findById: jest.fn().mockResolvedValue(row) });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { 'X-M365-Access-Token': 'graph-token' }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = {
      assertConnectorAccess: jest.fn().mockResolvedValue(undefined),
      headers: jest.fn((_url: string, _user: string, headers: Record<string, string>) =>
        Promise.resolve({ ...headers, Authorization: 'Bearer assertion' })),
    };
    const service = new ConnectorService(
      store, categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any, auth as any, createPlaybookBindingSyncServiceMock() as any, null as any, mcpJwt as any,
    );

    const result = await service.inspectMcp(row.mcpTransportType, row.mcpServerUrl, row.mcpServerConfig,
      'user-1', undefined, row.runtimeAuthConfig, undefined, undefined, row.id);

    expect(result.error).toBeUndefined();
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const lastCall = (StreamableHTTPClientTransport as unknown as jest.Mock).mock.calls.at(-1) as [URL, { requestInit: { headers: Record<string, string> } }];
    expect(lastCall[1].requestInit.headers).toEqual({ 'X-M365-Access-Token': 'graph-token', Authorization: 'Bearer assertion' });
  });

  it('refuses to inspect a combined internal_jwt connector when the provider credential is gone', async () => {
    const row = baseRow({
      id: '507f1f77bcf86cd799439044',
      name: 'SharePoint',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://mcp-sharepoint.example.test/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    });
    const store = connectorStoreMock({ findById: jest.fn().mockResolvedValue(row) });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), headers: jest.fn() };
    const service = new ConnectorService(
      store, categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any, auth as any, createPlaybookBindingSyncServiceMock() as any, null as any, mcpJwt as any,
    );

    const result = await service.inspectMcp(row.mcpTransportType, row.mcpServerUrl, row.mcpServerConfig,
      'user-1', undefined, row.runtimeAuthConfig, undefined, undefined, row.id);

    expect(result.error).toBe('The protected MCP connector has no usable provider credential');
    expect(result.tools).toEqual([]);
    expect(mcpJwt.headers).not.toHaveBeenCalled();
  });

  it('refuses to inspect when the provider credential only fills the assertion slot', async () => {
    const row = baseRow({
      id: '507f1f77bcf86cd799439046',
      name: 'SharePoint',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'Authorization', headerPrefix: 'Bearer ' },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://mcp-sharepoint.example.test/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    });
    const store = connectorStoreMock({ findById: jest.fn().mockResolvedValue(row) });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer graph-token' }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), headers: jest.fn() };
    const service = new ConnectorService(
      store, categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any, auth as any, createPlaybookBindingSyncServiceMock() as any, null as any, mcpJwt as any,
    );

    const result = await service.inspectMcp(row.mcpTransportType, row.mcpServerUrl, row.mcpServerConfig,
      'user-1', undefined, row.runtimeAuthConfig, undefined, undefined, row.id);

    expect(result.error).toBe('The protected MCP connector has no usable provider credential');
    expect(mcpJwt.headers).not.toHaveBeenCalled();
  });

  it('refuses a mixed provider mapping whose token sits in the assertion slot', async () => {
    const row = baseRow({
      id: '507f1f77bcf86cd799439047',
      name: 'SharePoint',
      authSourceType: 'connected_app',
      connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'custom_headers', headerMappings: { Authorization: 'Bearer {token}', 'X-Client-Id': 'yellowstorm' } },
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://mcp-sharepoint.example.test/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-sharepoint', actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] },
      actions: [{ key: 'list_accessible_sites', isEnabled: true }],
    });
    const store = connectorStoreMock({ findById: jest.fn().mockResolvedValue(row) });
    const auth = {
      // The unrelated client id must not stand in for the credential that the
      // assertion later overwrites in Authorization.
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer graph-token', 'X-Client-Id': 'yellowstorm' }, env: {},
      }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), headers: jest.fn() };
    const service = new ConnectorService(
      store, categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any, auth as any, createPlaybookBindingSyncServiceMock() as any, null as any, mcpJwt as any,
    );

    const result = await service.inspectMcp(row.mcpTransportType, row.mcpServerUrl, row.mcpServerConfig,
      'user-1', undefined, row.runtimeAuthConfig, undefined, undefined, row.id);

    expect(result.error).toBe('The protected MCP connector has no usable provider credential');
    expect(mcpJwt.headers).not.toHaveBeenCalled();
  });

  it('still inspects approved remote transports through the MCP SDK', async () => {
    const { service } = buildInspectionService();

    const sseResult = await service.inspectMcp('sse', 'https://mcp.example.test/sse');
    const httpResult = await service.inspectMcp('streamable_http', 'https://mcp.example.test/mcp');

    expect(sseResult.error).toBeUndefined();
    expect(sseResult.tools).toEqual([expect.objectContaining({ name: 'list_files', safety: 'read' })]);
    expect(httpResult.error).toBeUndefined();
    const streamableMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    expect(streamableMod.StreamableHTTPClientTransport).toHaveBeenCalled();
  });

  it('asks the egress policy for every inspected destination before any transport is built (WP-05)', async () => {
    const { service } = buildInspectionService();

    await service.inspectMcp('streamable_http', 'https://mcp.example.test/mcp');

    expect(assertMcpDestinationAllowed).toHaveBeenCalledWith('https://mcp.example.test/mcp', expect.objectContaining({ allowExactEndpoints: expect.any(Array) }));
  });

  it('does not grant private-network egress from environment URL trust alone', async () => {
    const store = connectorStoreMock();
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
      { get: (key: string, fallback?: string) => (
        key === 'SEMANTIC_MODEL_MCP_SERVER_URL' ? 'http://localhost:8027/mcp'
          : fallback
      ) } as any,
    );

    await service.inspectMcp('streamable_http', 'http://localhost:8027/mcp');

    expect(assertMcpDestinationAllowed).toHaveBeenCalledWith('http://localhost:8027/mcp', expect.objectContaining({
      allowExactEndpoints: [],
    }));
  });

  it('denies a Bearer-mode internal endpoint the WP05.5 exception does not cover (JWT-only services)', async () => {
    const store = connectorStoreMock();
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
      { get: (key: string, fallback?: string) => (
        key === 'SEMANTIC_MODEL_MCP_SERVER_URL' ? 'http://localhost:8027/mcp'
          : fallback
      ) } as any,
    );

    // The stubbed policy resolves; the wiring assertion is that a Bearer-mode
    // service URL grants NO exception — the real denial logic is covered in
    // the policy util's own suite.
    await service.inspectMcp('streamable_http', 'http://localhost:8027/mcp');

    expect(assertMcpDestinationAllowed).toHaveBeenCalledWith('http://localhost:8027/mcp', expect.objectContaining({
      allowExactEndpoints: [],
    }));
  });

  it.each([
    ['forbidden_address', '169.254.169.254'],
    ['dns_failure', ''],
    ['insecure_http', ''],
    ['port_not_allowed', ''],
  ] as const)('denies destination "%s" with a deterministic 400 and neutral message', async (reason, host) => {
    const { service, store } = buildInspectionService();
    assertMcpDestinationAllowed.mockRejectedValue(new McpDestinationPolicyError(reason, host));

    await expect(service.inspectMcp('streamable_http', 'https://mcp.example.test/mcp'))
      .rejects.toMatchObject({ code: ErrorCode.CONNECTOR_MCP_DESTINATION_BLOCKED });
    expect(store.findById).not.toHaveBeenCalled();
  });

  it('denies inspection before credential resolution or OAuth token fetch when the destination is blocked', async () => {
    const { service } = buildInspectionService();
    assertMcpDestinationAllowed.mockRejectedValue(new McpDestinationPolicyError('forbidden_address', 'metadata.internal'));

    await expect(service.inspectMcp('sse', 'https://metadata.internal/sse', {}, 'user-1', 'github'))
      .rejects.toMatchObject({ code: ErrorCode.CONNECTOR_MCP_DESTINATION_BLOCKED });
  });

  it('never hands stdio connectors to runtime gRPC bindings', async () => {
    const row = baseRow({
      id: '507f1f77bcf86cd799439041',
      slug: 'legacy-stdio',
      mcpTransportType: 'stdio',
      mcpServerUrl: '/usr/local/bin/some-mcp',
      actions: [{ key: 'run', label: 'Run', isEnabled: true }] as ConnectorRow['actions'],
    });
    const store = connectorStoreMock({
      findByIds: jest.fn().mockResolvedValue([row]),
    });
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), warn: jest.fn() } as any,
      null as any,
      { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    const bindings = await service.findByIdsForGrpc([row.id], 'user-1');

    expect(bindings).toEqual([]);
  });
});

describe('ConnectorService secret-free public projections (SEC-02 / WP-02)', () => {
  const CANARY = 'CANARY-secret-9f2a1b';
  const secretRow = (): ConnectorRow => baseRow({
    id: '507f1f77bcf86cd799439042',
    slug: 'secretive',
    authSourceType: 'credential',
    runtimeAuthConfig: {
      strategy: 'http_header_bearer',
      headerName: 'Authorization',
      headerPrefix: `Bearer ${CANARY}`,
      envMap: { API_KEY: CANARY },
      unknownNested: { inner: CANARY },
    },
    mcpServerUrl: `https://user:${CANARY}@mcp.example.test/mcp`,
    mcpServerConfig: {
      headers: { Authorization: `Bearer ${CANARY}`, 'X-API-Key': CANARY },
      env: { SHARED_SECRET: CANARY },
      nestedUnknown: CANARY,
    },
    actions: [{ key: 'search', label: 'Search', isEnabled: true }] as ConnectorRow['actions'],
  });

  const buildServiceWithRow = (row: ConnectorRow) => {
    const store = connectorStoreMock({
      findById: jest.fn().mockResolvedValue(row),
      findByIds: jest.fn().mockResolvedValue([row]),
      list: jest.fn().mockResolvedValue({ rows: [row], total: 1 }),
      findAllActiveVisible: jest.fn().mockResolvedValue([row]),
    });
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );
    return service;
  };

  it('omits runtimeAuthConfig/mcpServerConfig and every canary from every read/write response path', async () => {
    const row = secretRow();
    const store = connectorStoreMock({
      findById: jest.fn().mockResolvedValue(row),
      findActiveBySlug: jest.fn().mockResolvedValue(row),
      findByIds: jest.fn().mockResolvedValue([row]),
      list: jest.fn().mockResolvedValue({ rows: [row], total: 1 }),
      findAllActiveVisible: jest.fn().mockResolvedValue([row]),
      insert: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
    });
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    const responses = [
      await service.findById(row.id),
      (await service.findByIds([row.id]))[0],
      (await service.findBySlug('secretive'))!,
      (await service.findAll({} as never)).data[0],
      (await service.findAllActive())[0],
      await service.create('creator-1', {
        slug: 'created-secretive',
        name: 'Created',
        description: '',
        runtimeAuthConfig: { headerPrefix: `Bearer ${CANARY}` },
        mcpServerConfig: { headers: { 'X-API-Key': CANARY } },
      } as never),
      await service.update(row.id, {
        expectedSecurityRevision: 1,
        runtimeAuthConfig: { headerPrefix: `Bearer ${CANARY}` },
      } as never),
    ];

    expect(responses).toHaveLength(7);
    for (const response of responses) {
      expect(response).not.toHaveProperty('runtimeAuthConfig');
      expect(response).not.toHaveProperty('mcpServerConfig');
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain(CANARY);
      expect(serialized).not.toContain('Bearer ');
    }
  });

  it('summarises credentials as credentialConfigured and marks stdio rows unsupported for inspection', async () => {
    const service = buildServiceWithRow(secretRow());
    const response = await service.findById('507f1f77bcf86cd799439042');
    expect(response.credentialConfigured).toBe(true);

    const stdioService = buildServiceWithRow(baseRow({ mcpTransportType: 'stdio' }));
    const stdioResponse = await stdioService.findById('507f1f77bcf86cd799439031');
    expect(stdioResponse.inspectionStatus).toBe('unsupported_for_http_inspection');
    expect(stdioResponse.credentialConfigured).toBe(false);
  });

  it('strips embedded URL credentials from the exposed endpoint', async () => {
    const service = buildServiceWithRow(secretRow());
    const response = await service.findById('507f1f77bcf86cd799439042');
    expect(response.mcpServerUrl).toBe('https://mcp.example.test/mcp');
  });

  it('rejects stdio transport and credential-bearing URLs on create and update', async () => {
    const service = buildServiceWithRow(baseRow());

    await expect(service.create('creator-1', {
      slug: 'local',
      name: 'Local',
      description: '',
      mcpTransportType: 'stdio',
    } as never)).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.create('creator-1', {
      slug: 'leaky',
      name: 'Leaky',
      description: '',
      mcpServerUrl: 'https://user:pass@mcp.example.test/mcp',
    } as never)).rejects.toThrow('embedded credentials');

    await expect(service.update('507f1f77bcf86cd799439031', {
      mcpServerUrl: 'https://user:pass@mcp.example.test/mcp',
    } as never)).rejects.toThrow('embedded credentials');
  });

  it('clears stored runtime credentials only via the explicit clear flag', async () => {
    const row = secretRow();
    const store = connectorStoreMock({
      findById: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue({ ...row, runtimeAuthConfig: {} }),
    });
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), warn: jest.fn() } as any,
      null as any,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    // Omitted credential fields preserve the stored secret.
    await service.update('507f1f77bcf86cd799439042', { name: 'Renamed' } as never);
    expect(store.update).toHaveBeenCalledWith('507f1f77bcf86cd799439042', expect.not.objectContaining({ runtimeAuthConfig: expect.anything() }));

    // The explicit flag clears without reading.
    await service.update('507f1f77bcf86cd799439042', { clearRuntimeAuthConfig: true, expectedSecurityRevision: 1 } as never);
    expect(store.update).toHaveBeenLastCalledWith('507f1f77bcf86cd799439042', expect.objectContaining({ runtimeAuthConfig: {} }), 1);
  });

  it('keeps runtime bindings server-side: findByIdsForGrpc still receives raw secret-bearing rows', async () => {
    const row = secretRow();
    const store = connectorStoreMock({
      findByIds: jest.fn().mockResolvedValue([row]),
    });
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { Authorization: `Bearer ${CANARY}` }, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const service = new ConnectorService(
      store,
      categoryStoreMock(),
      { setContext: jest.fn(), warn: jest.fn() } as any,
      null as any,
      auth as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    const [binding] = await service.findByIdsForGrpc([row.id], 'user-1');

    expect(auth.resolveRuntimeAuth).toHaveBeenCalledWith('user-1', expect.objectContaining({
      runtimeAuthConfig: expect.objectContaining({ headerPrefix: `Bearer ${CANARY}` }),
    }));
    expect(binding.auth_headers).toEqual({ Authorization: `Bearer ${CANARY}` });
  });

  it('scrubs credential material from inspection error messages and logs hosts only (WP02.8)', async () => {
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new ConnectorService(
      connectorStoreMock(),
      categoryStoreMock(),
      logger as any,
      null as any,
      { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) } as any,
      createPlaybookBindingSyncServiceMock() as any,
    );

    const scrubbed = (service as unknown as {
      toSafeInspectErrorMessage(err: unknown): string;
    }).toSafeInspectErrorMessage(new Error(
      `getaddrinfo ENOTFOUND for https://user:${CANARY}@mcp.example.test/mcp with Bearer ${CANARY}`,
    ));

    expect(scrubbed).not.toContain(CANARY);
    expect(scrubbed).toContain('https://***@mcp.example.test/mcp');
    expect(scrubbed).toContain('Bearer ***');

    // Multiple userinfo segments: the password after a second '@' must not
    // survive the scrub (re-review finding).
    const multiAt = (service as unknown as {
      toSafeInspectErrorMessage(err: unknown): string;
    }).toSafeInspectErrorMessage(new Error(
      `fetch failed for https://user:prefix@${CANARY}@mcp.example.test/mcp`,
    ));
    expect(multiAt).not.toContain(CANARY);
    expect(multiAt).toContain('https://***@mcp.example.test/mcp');

    const context = (service as unknown as {
      inspectLogContext(serverUrl: string): { host: string };
    }).inspectLogContext('https://user:pass@mcp.example.test/mcp');
    expect(context).toEqual({ host: 'mcp.example.test' });

    // End to end: a remote inspection whose SDK connect fails returns the
    // scrubbed message and never logs the URL or raw error payload.
    const indexMod = await import('@modelcontextprotocol/sdk/client/index.js');
    jest.mocked(indexMod.Client).mockImplementationOnce(() => ({
      connect: jest.fn().mockRejectedValue(new Error(
        `SDK exploded for https://user:${CANARY}@mcp.example.test/mcp with Bearer ${CANARY}`,
      )),
      listTools: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }) as never);
    const result = await service.inspectMcp('sse', 'https://mcp.example.test/sse');
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain(CANARY);
    const loggedArgs = JSON.stringify(logger.error.mock.calls);
    expect(loggedArgs).not.toContain(CANARY);
    expect(loggedArgs).not.toContain('mcp.example.test/sse');
  });
});
