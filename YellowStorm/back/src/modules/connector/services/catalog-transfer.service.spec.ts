import { EncryptedCatalogArchive } from '../interfaces/catalog-transfer.interface';
import { decryptCatalogArchive } from '../utils/catalog-archive-crypto.util';
import { CatalogTransferService } from './catalog-transfer.service';

const ownerId = '507f1f77bcf86cd799439021';
const connectorId = '507f1f77bcf86cd799439022';
const connectorCategoryId = '507f1f77bcf86cd799439023';
const skillId = '507f1f77bcf86cd799439024';
const skillCategoryId = '507f1f77bcf86cd799439025';

const connector = {
  id: connectorId,
  slug: 'sharepoint',
  name: 'SharePoint',
  description: 'Search SharePoint',
  icon: 'FaMicrosoft',
  color: '#123456',
  iconColor: 'dark',
  categoryId: connectorCategoryId,
  authType: 'oauth2',
  authConfigSchema: { type: 'object' },
  authSourceType: 'connected_app',
  connectedAppKey: 'microsoft',
  runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'Authorization' },
  mcpTransportType: 'streamable_http',
  mcpServerUrl: 'https://mcp.example.test',
  mcpServerConfig: { timeout: 1000 },
  workerPolicy: { enabled: false, defaultExecutionKind: 'unknown', agentLaunchEnabled: false },
  dynamicHeaders: [{ headerName: 'X-User-Id', source: 'user_id', enabled: true }],
  actions: [{
    key: 'search',
    label: 'Search',
    description: 'Search content',
    parameterSchema: { type: 'object' },
    outputSchema: { type: 'array' },
    safety: 'read',
    workerAccess: 'block',
    executionKind: 'orchestration',
    supportsBatch: true,
    supportsIteration: true,
    isEnabled: true,
  }],
  skillIds: [skillId],
  // projectConnector still resolves referencedSkillSlugs from the legacy field name.
  referencedSkillIds: [skillId],
  isActive: false,
  isSystem: true,
  isHidden: true,
};

const skill = {
  id: skillId,
  slug: 'document-search',
  name: 'document-search',
  description: 'Search documents',
  icon: 'FaSearch',
  color: '#abcdef',
  iconColor: 'light',
  categoryId: skillCategoryId,
  license: 'internal',
  compatibility: 'all',
  metadata: { owner: 'platform' },
  allowedTools: ['Read'],
  instructions: 'Search carefully.',
  files: [{ path: 'references/help.md', kind: 'reference', mimeType: 'text/markdown', content: 'Help' }],
  isActive: false,
};

const pgDb = {
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  execute: jest.fn(),
};

const cryptoService = {
  isEncrypted: (value: string) => value.startsWith('enc:'),
  decrypt: (value: string) => value.slice(4),
  encrypt: (value: string) => `target:${value}`,
};

describe('CatalogTransferService export fidelity', () => {
  function createService(includeSecurity = false, connectorStoreOverride?: Record<string, jest.Mock>) {
    const connectorStore = {
      findAllExport: jest.fn().mockResolvedValue([connector]),
      ...connectorStoreOverride,
    };
    const connectorCategoryStore = {
      findAll: jest.fn().mockResolvedValue([{
        id: connectorCategoryId,
        name: 'Knowledge',
        description: 'Knowledge systems',
        isSystem: false,
      }]),
    };
    const credentialStore = {
      list: jest.fn().mockResolvedValue(includeSecurity ? [{
        id: 'credential-1',
        connectorId,
        displayName: 'Primary',
        authPayload: { token: 'credential-token' },
        status: 'active',
        lastValidatedAt: null,
        expiresAt: null,
      }] : []),
    };
    const adminAuthStore = {
      findByUserAndApp: jest.fn().mockResolvedValue(null),
    };
    const skillStore = {
      findAllExport: jest.fn().mockResolvedValue([skill]),
    };
    const skillCategoryStore = {
      findAll: jest.fn().mockResolvedValue([{
        id: skillCategoryId,
        name: 'Retrieval',
        description: 'Retrieval skills',
        isSystem: false,
      }]),
    };
    const appDefinitionStore = {
      findAll: jest.fn().mockResolvedValue(includeSecurity ? [{
        id: 'definition-1',
        appKey: 'microsoft',
        displayName: 'Microsoft',
        authorizationUrl: 'https://login.example.test',
        tokenUrl: 'https://token.example.test',
        clientId: 'enc:client-id',
        clientSecret: 'enc:client-secret',
        scopes: ['files.read'],
        enabled: true,
      }] : []),
    };
    const appConnectionStore = {
      listByUser: jest.fn().mockResolvedValue(includeSecurity ? [{
        id: 'connection-1',
        appKey: 'microsoft',
        accessToken: 'enc:access-token',
        scopes: ['files.read'],
        status: 'active',
      }] : []),
    };
    const service = new CatalogTransferService(
      connectorStore as never,
      connectorCategoryStore as never,
      credentialStore as never,
      adminAuthStore as never,
      skillStore as never,
      skillCategoryStore as never,
      appDefinitionStore as never,
      appConnectionStore as never,
      pgDb as never,
      cryptoService as never,
    );
    return service;
  }

  it('preserves restrictive worker policy and action classification through archive parsing', async () => {
    const service = createService();
    const result = await service.exportConnectors(ownerId, { selection: 'all', includeSecurity: false } as never);
    const archive = service.parseArchive(result.buffer);
    expect(archive.connectors[0].workerPolicy).toEqual(connector.workerPolicy);
    expect(archive.connectors[0].actions[0]).toMatchObject({ workerAccess: 'block', executionKind: 'orchestration' });
  });

  it('carries no credential config in the unencrypted archive, even in unusual field shapes', async () => {
    const canary = 'export-canary-4f9d';
    const secretConnector = {
      ...connector,
      runtimeAuthConfig: {
        strategy: 'http_header_bearer',
        headerPrefix: `Bearer ${canary}`,
        envMap: { KEY: canary },
        nestedUnknown: { inner: canary },
      },
      mcpServerUrl: `https://user:${canary}@mcp.example.test/mcp?token=${canary}#${canary}`,
      description: `Imported from https://mcp.example.test/mcp?arbitrary=${canary}`,
      authConfigSchema: { unknown: { default: canary } },
      actions: [{ ...connector.actions[0], description: canary,
        parameterSchema: { properties: { query: { type: 'string', default: canary } } },
      }],
      mcpServerConfig: { headers: { Authorization: `Bearer ${canary}` }, env: { SECRET: canary }, unknown: canary },
    };
    const store = {
      findAllExport: jest.fn().mockResolvedValue([secretConnector]),
      findNamesByIds: jest.fn().mockResolvedValue(new Map()),
    };
    const service = createService(false, store);
    const result = await service.exportConnectors(ownerId, { selection: 'all', includeSecurity: false } as never);
    const serialized = result.buffer.toString('utf8');

    expect(serialized).not.toContain(canary);
    const archive = JSON.parse(serialized);
    expect(archive.connectors[0].runtimeAuthConfig).toEqual({});
    expect(archive.connectors[0].mcpServerConfig).toEqual({});
    expect(archive.connectors[0].mcpServerUrl).toBe('https://mcp.example.test/mcp');
    expect(archive.securityIncluded).toBe(false);
  });

  it('exports all catalog properties and resolves relationships by skill slug', async () => {
    const result = await createService().exportConnectors(ownerId, {
      selection: 'selected',
      ids: [connectorId],
    });
    const archive = JSON.parse(result.buffer.toString('utf8'));

    expect(archive.connectors[0]).toEqual(expect.objectContaining({
      slug: 'sharepoint',
      categoryName: 'Knowledge',
      icon: 'FaMicrosoft',
      color: '#123456',
      iconColor: 'dark',
      isActive: false,
      isSystem: true,
      isHidden: true,
      referencedSkillSlugs: ['document-search'],
    }));
    expect(archive.connectors[0].actions[0]).toEqual(expect.objectContaining({
      key: 'search',
      supportsBatch: true,
      supportsIteration: true,
      isEnabled: true,
    }));
    expect(archive.skills[0]).toEqual(expect.objectContaining({
      slug: 'document-search',
      categoryName: 'Retrieval',
      icon: 'FaSearch',
      color: '#abcdef',
      isActive: false,
      files: [{ path: 'references/help.md', kind: 'reference', mimeType: 'text/markdown', content: 'Help' }],
    }));
  });

  it('encrypts exported credentials, app secrets, and tokens with a portable passphrase', async () => {
    const result = await createService(true).exportConnectors(ownerId, {
      selection: 'all',
      includeSecurity: true,
      passphrase: 'portable-passphrase',
    });
    const serialized = result.buffer.toString('utf8');
    expect(serialized).not.toContain('credential-token');
    expect(serialized).not.toContain('client-secret');
    expect(serialized).not.toContain('access-token');

    const archive = decryptCatalogArchive(
      JSON.parse(serialized) as EncryptedCatalogArchive,
      'portable-passphrase',
    );
    expect(archive.security?.connectorCredentials[0].authPayload).toEqual({ token: 'credential-token' });
    expect(archive.security?.connectedAppDefinitions[0].clientSecret).toBe('client-secret');
    expect(archive.security?.userAppConnections[0].accessToken).toBe('access-token');
  });

  it('keeps an explicitly privileged legacy endpoint only inside the encrypted archive', async () => {
    const canary = 'TEST_CANARY_R03';
    const endpoint = `https://mcp.example.test/mcp?token=${canary}`;
    const store = { findAllExport: jest.fn().mockResolvedValue([{ ...connector, mcpServerUrl: endpoint }]),
      findNamesByIds: jest.fn().mockResolvedValue(new Map()) };
    const result = await createService(true, store).exportConnectors(ownerId, {
      selection: 'all', includeSecurity: true, passphrase: 'synthetic-portable-passphrase',
    });
    expect(result.buffer.toString('utf8')).not.toContain(canary);
    const archive = decryptCatalogArchive(JSON.parse(result.buffer.toString('utf8')) as EncryptedCatalogArchive,
      'synthetic-portable-passphrase');
    expect(archive.connectors[0].mcpServerUrl).toBe(endpoint);
  });

  it.each([
    ['not-an-endpoint?token=TEST_CANARY_R03', 'not-an-endpoint?token=TEST_CANARY_R03'],
    ['https://user:TEST_CANARY_R03@[invalid/mcp', 'TEST_CANARY_R03'],
    ['https://mcp.example.test/mcp?token=TEST_CANARY_R03', '%54%45%53%54%5f%43%41%4e%41%52%59%5f%52%30%33%ZZ'],
    ['https://mcp.example.test/mcp?token=TEST_CANARY_R03', '%54%45%53%54%5f%43%41%4e%41%52%59%5f%52%30%33%FF'],
    ['https://mcp.example.test/mcp?token=TEST_CANARY_R03', '%54%45%53%54%5f%43%41%4e%41%52%59%5f%52%30%33%E2%82'],
  ])('fails closed for malformed historical URL/metadata in ordinary exports', async (endpoint, description) => {
    const store = { findAllExport: jest.fn().mockResolvedValue([{ ...connector, mcpServerUrl: endpoint,
      description, authConfigSchema: { nested: { default: 'TEST_CANARY_R03' } },
    }]), findNamesByIds: jest.fn().mockResolvedValue(new Map()) };
    const result = await createService(false, store).exportConnectors(ownerId, { selection: 'all', includeSecurity: false });
    const serialized = result.buffer.toString('utf8');
    expect(serialized).not.toContain('TEST_CANARY_R03');
    expect(serialized).not.toContain('%54%45%53%54');
    expect(serialized).not.toContain('not-an-endpoint');
  });

  it('preserves target secrets on overwrite and drops redacted values for new connectors', () => {
    const service = createService();
    const restore = (service as unknown as {
      restoreRedactedValues(imported: unknown, existing: unknown): unknown;
    }).restoreRedactedValues.bind(service);

    expect(restore(
      { strategy: 'header', headers: { Authorization: '__REDACTED__', Accept: 'json' } },
      { strategy: 'header', headers: { Authorization: 'Bearer target-token' } },
    )).toEqual({
      strategy: 'header',
      headers: { Authorization: 'Bearer target-token', Accept: 'json' },
    });
    expect(restore(
      { headers: { Authorization: '__REDACTED__' } },
      {},
    )).toEqual({ headers: {} });
  });

  it('keeps target credential config when a structure-only archive overwrites a connector', async () => {
    const canary = 'import-canary-9ab2';
    const existing = {
      ...connector,
      runtimeAuthConfig: { headerPrefix: `Bearer ${canary}` },
      mcpServerConfig: { headers: { 'X-API-Key': canary } },
    };
    const connectorStore = {
      findBySlugAndOwner: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(existing),
      insert: jest.fn(),
    };
    const service = createService(false, connectorStore);
    const importConnectors = (service as unknown as {
      importConnectors(
        connectors: unknown[],
        ownerId: string,
        categoryIds: Map<string, string>,
        skillIds: Map<string, string>,
        policy: 'overwrite',
        result: unknown,
      ): Promise<void>;
    }).importConnectors.bind(service);
    const result = { connectors: { created: 0, updated: 0, skipped: 0 } };
    const categoryIds = new Map([['Knowledge', connectorCategoryId]]);

    // Structure-only archive (empty config): the stored secrets are preserved.
    await importConnectors(
      [{ ...connector, runtimeAuthConfig: {}, mcpServerConfig: {}, referencedSkillSlugs: [] }],
      ownerId,
      categoryIds,
      new Map(),
      'overwrite',
      result,
    );
    const preservedPatch = connectorStore.update.mock.calls[0][1] as Record<string, unknown>;
    expect(preservedPatch).not.toHaveProperty('runtimeAuthConfig');
    expect(preservedPatch).not.toHaveProperty('mcpServerConfig');

    // Archives that DO carry config still overwrite through the restore path.
    await importConnectors(
      [{ ...connector, runtimeAuthConfig: { strategy: 'custom_headers' }, mcpServerConfig: { timeout: 5 }, referencedSkillSlugs: [] }],
      ownerId,
      categoryIds,
      new Map(),
      'overwrite',
      result,
    );
    const overwrittenPatch = connectorStore.update.mock.calls[1][1] as Record<string, unknown>;
    expect(overwrittenPatch.runtimeAuthConfig).toEqual({ strategy: 'custom_headers' });
    expect(overwrittenPatch.mcpServerConfig).toEqual({ timeout: 5 });
  });

  it('rejects attempts to elevate an existing category to system status', async () => {
    const skillCategoryStore = {
      findByNameInsensitive: jest.fn().mockResolvedValue({ id: 'category-1', name: 'Normal', isSystem: false }),
      update: jest.fn(),
    };
    const service = new CatalogTransferService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      skillCategoryStore as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const importCategories = (service as unknown as {
      importSkillCategories(
        categories: { name: string; description: string; isSystem: boolean }[],
        policy: 'overwrite',
        result: unknown,
      ): Promise<unknown>;
    }).importSkillCategories.bind(service);

    await expect(importCategories(
      [{ name: 'Normal', description: 'Changed', isSystem: true }],
      'overwrite',
      { categories: { created: 0, reused: 0 } },
    )).rejects.toThrow('A skill category cannot be elevated to a system category.');
    expect(skillCategoryStore.update).not.toHaveBeenCalled();
  });
});
