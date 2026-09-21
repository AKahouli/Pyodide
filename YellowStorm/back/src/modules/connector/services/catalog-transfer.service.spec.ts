import { Types } from 'mongoose';
import { decryptCatalogArchive } from '../utils/catalog-archive-crypto.util';
import { EncryptedCatalogArchive } from '../interfaces/catalog-transfer.interface';
import { CatalogTransferService } from './catalog-transfer.service';

const query = <T>(value: T) => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(value) }) });

describe('CatalogTransferService export fidelity', () => {
  const ownerId = new Types.ObjectId();
  const connectorId = new Types.ObjectId();
  const connectorCategoryId = new Types.ObjectId();
  const skillId = new Types.ObjectId();
  const skillCategoryId = new Types.ObjectId();
  const connector = {
    _id: connectorId,
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
    referencedSkillIds: [skillId],
    isActive: false,
    isSystem: true,
    isHidden: true,
  };
  const skill = {
    id: skillId.toString(),
    _id: skillId,
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

  function createService(includeSecurity = false) {
    const connectorModel = { find: jest.fn().mockReturnValue(query([connector])) };
    const connectorCategoryModel = {
      find: jest.fn().mockReturnValue(query([{
        _id: connectorCategoryId,
        name: 'Knowledge',
        description: 'Knowledge systems',
        isSystem: false,
      }])),
    };
    const skillStore = { findAllExport: jest.fn().mockResolvedValue([skill]) };
    const skillCategoryStore = {
      findAll: jest.fn().mockResolvedValue([{
        id: skillCategoryId.toString(),
        name: 'Retrieval',
        description: 'Retrieval skills',
        isSystem: false,
      }]),
    };
    const credentialModel = {
      find: jest.fn().mockReturnValue(query(includeSecurity ? [{
        connectorId,
        displayName: 'Primary',
        authPayload: { token: 'credential-token' },
        status: 'active',
        lastValidatedAt: null,
        expiresAt: null,
      }] : [])),
    };
    const appDefinitionModel = {
      find: jest.fn().mockReturnValue(query(includeSecurity ? [{
        appKey: 'microsoft',
        displayName: 'Microsoft',
        authorizationUrl: 'https://login.example.test',
        tokenUrl: 'https://token.example.test',
        clientId: 'enc:client-id',
        clientSecret: 'enc:client-secret',
        scopes: ['files.read'],
        enabled: true,
      }] : [])),
    };
    const appConnectionModel = {
      find: jest.fn().mockReturnValue(query(includeSecurity ? [{
        appKey: 'microsoft',
        accessToken: 'enc:access-token',
        scopes: ['files.read'],
        status: 'active',
      }] : [])),
    };
    const adminAuthModel = { find: jest.fn().mockReturnValue(query([])) };
    const cryptoService = {
      isEncrypted: (value: string) => value.startsWith('enc:'),
      decrypt: (value: string) => value.slice(4),
      encrypt: (value: string) => `target:${value}`,
    };
    return new CatalogTransferService(
      connectorModel as never,
      connectorCategoryModel as never,
      credentialModel as never,
      adminAuthModel as never,
      skillStore as never,
      skillCategoryStore as never,
      { execute: jest.fn() } as never,
      appDefinitionModel as never,
      appConnectionModel as never,
      {} as never,
      cryptoService as never,
    );
  }

  it('exports all catalog properties and resolves relationships by skill slug', async () => {
    const result = await createService().exportConnectors(ownerId.toString(), {
      selection: 'selected',
      ids: [connectorId.toString()],
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
    const result = await createService(true).exportConnectors(ownerId.toString(), {
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
      findByNameInsensitive: jest.fn().mockResolvedValue({ id: new Types.ObjectId().toString(), name: 'Normal', isSystem: false }),
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
      {} as never,
    );
    const importCategories = (service as unknown as {
      importSkillCategories(
        categories: Array<{ name: string; description: string; isSystem: boolean }>,
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
