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
  dynamicHeaders: [{ headerName: 'X-User-Id', source: 'user_id', enabled: true }],
  actions: [{
    key: 'search',
    label: 'Search',
    description: 'Search content',
    parameterSchema: { type: 'object' },
    outputSchema: { type: 'array' },
    safety: 'read',
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
  function createService(includeSecurity = false) {
    const connectorStore = {
      findAllExport: jest.fn().mockResolvedValue([connector]),
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
