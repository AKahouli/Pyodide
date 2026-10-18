import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@common/services/crypto.service';
import { CatalogTransferService } from './catalog-transfer.service';
import { openConnectorHeaders, sealConnectorHeaders } from '../connector-auth.service';
import { AdminCatalogTransferController } from '../admin-catalog-transfer.controller';
import { Permissions } from '@modules/authorization/constants/permissions';

describe('Encrypted catalog header portability and transaction boundaries', () => {
  const owner = '507f1f77bcf86cd799439021', sourceId = '507f1f77bcf86cd799439022';
  const targetId = '507f1f77bcf86cd799439023', endpoint = 'https://mcp.example.test/mcp';
  const canary = 'TEST_CANARY_R03_PORTABLE_HEADER', passphrase = 'synthetic-portability-passphrase';
  const fixture = (key: string) => {
    const config = new ConfigService({ app: { encryptionKey: key.repeat(32) } });
    const crypto = new CryptoService(config);
    const source = { id: sourceId, slug: 'portable-mcp', name: 'Portable MCP', description: '', categoryId: null,
      authType: 'none', authSourceType: 'server_config', connectedAppKey: '', mcpTransportType: 'streamable_http',
      mcpServerUrl: endpoint, mcpServerConfig: {}, dynamicHeaders: [], actions: [], skillIds: [], securityRevision: 1, isActive: true,
      mcpSecurityPolicy: { version: 1, profile: 'configured', actorDelegation: 'none', allowPrivateNetwork: false,
        allowInsecureHttp: false, requiredPermissions: [] },
      runtimeAuthConfig: sealConnectorHeaders(crypto, config, sourceId, endpoint, { 'X-Api-Key': canary }) };
    const rows = new Map<string, Record<string, unknown>>();
    const store = {
      findAllExport: jest.fn(async () => [source]),
      findBySlugAndOwner: jest.fn(async () => [...rows.values()][0] ?? null),
      insert: jest.fn(async (row: Record<string, unknown>) => {
        const inserted = { ...row, id: targetId, securityRevision: 1, mcpSecurityPolicy: source.mcpSecurityPolicy };
        rows.set(targetId, inserted); return inserted;
      }),
      update: jest.fn(async (id: string, patch: Record<string, unknown>, revision?: number) => {
        const before = rows.get(id);
        if (!before || revision !== undefined && before.securityRevision !== revision) return null;
        const updated = { ...before, ...patch, securityRevision: Number(before.securityRevision) + 1 };
        rows.set(id, updated); return updated;
      }),
    };
    const rollback = jest.fn();
    // This fixture verifies the import's transaction/throw contract. Actual
    // PostgreSQL rollback and deployment rights remain separate integration gates.
    const db = { transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone([...rows.entries()]);
      try { return await run({}); } catch (error) {
        rows.clear(); for (const [id, row] of snapshot) rows.set(id, row);
        rollback(); throw error;
      }
    } };
    const service = new CatalogTransferService(store as never, {} as never,
      { list: async () => [] } as never, {} as never, {} as never, {} as never,
      { findAll: async () => [] } as never, { listByUser: async () => [] } as never,
      db as never, crypto, config);
    return { service, source, rows, store, crypto, config, rollback };
  };
  const exportProtected = (f: ReturnType<typeof fixture>) => f.service.exportConnectors(owner,
    { selection: 'all', includeSecurity: true, passphrase });

  it('moves headers only inside an encrypted archive and re-encrypts for the actual target ID/key', async () => {
    const source = fixture('a1'), target = fixture('b2');
    const exported = await exportProtected(source);
    expect(exported.buffer.toString()).not.toContain(canary);
    const archive = target.service.parseArchive(exported.buffer, passphrase);
    const result = await target.service.importArchive(owner, archive, 'overwrite');
    expect(result.connectors.created).toBe(1);
    const row = target.rows.get(targetId)!;
    expect(JSON.stringify(row)).not.toContain(canary);
    expect(openConnectorHeaders(target.crypto, target.config, targetId, row.runtimeAuthConfig as Record<string, unknown>).headers)
      .toEqual({ 'X-Api-Key': canary });
    expect(() => openConnectorHeaders(source.crypto, source.config, targetId, row.runtimeAuthConfig as Record<string, unknown>)).toThrow();
    expect(() => openConnectorHeaders(target.crypto, target.config, sourceId, row.runtimeAuthConfig as Record<string, unknown>)).toThrow();
  });

  it('rejects a failed post-insert credential write and rolls the import back', async () => {
    const source = fixture('a1'), target = fixture('b2');
    const archive = target.service.parseArchive((await exportProtected(source)).buffer, passphrase);
    target.store.update.mockResolvedValueOnce(null);
    await expect(target.service.importArchive(owner, archive, 'overwrite')).rejects.toThrow();
    expect(target.rollback).toHaveBeenCalledTimes(1);
    expect(target.rows.size).toBe(0);
  });

  it('rejects a failed revision-checked overwrite instead of reporting success', async () => {
    const source = fixture('a1'), target = fixture('b2');
    const existing = { ...target.source, id: targetId,
      runtimeAuthConfig: sealConnectorHeaders(target.crypto, target.config, targetId, endpoint, { 'X-Api-Key': 'target-only-token' }) };
    target.rows.set(targetId, existing);
    const archive = target.service.parseArchive((await exportProtected(source)).buffer, passphrase);
    target.store.update.mockResolvedValueOnce(null);
    await expect(target.service.importArchive(owner, archive, 'overwrite')).rejects.toThrow();
    expect(target.rollback).toHaveBeenCalledTimes(1);
    expect(target.rows.get(targetId)).toEqual(existing);
    expect(target.store.update.mock.calls[0][2]).toBe(1);
  });

  it('does not accept portable header material reconstructed outside authenticated archive parsing', async () => {
    const source = fixture('a1'), target = fixture('b2');
    const archive = target.service.parseArchive((await exportProtected(source)).buffer, passphrase);
    await expect(target.service.importArchive(owner, structuredClone(archive), 'overwrite')).rejects.toThrow();
    expect(target.store.insert).not.toHaveBeenCalled();
  });

  it('keeps ordinary exports free of runtime credentials and preserves hidden target configuration on roundtrip', async () => {
    const target = fixture('b2');
    const existing = { ...target.source, id: targetId,
      runtimeAuthConfig: sealConnectorHeaders(target.crypto, target.config, targetId, endpoint, { 'X-Api-Key': canary }) };
    target.rows.set(targetId, existing);
    const exported = await target.service.exportConnectors(owner, { selection: 'all', includeSecurity: false });
    expect(exported.buffer.toString()).not.toContain(canary);
    const archive = target.service.parseArchive(exported.buffer);
    expect(archive.connectors[0].runtimeAuthConfig).toEqual({});
    archive.connectors[0].dynamicHeaders = [{ headerName: 'X-Api-Key', source: 'user_email', enabled: true }];
    archive.connectors[0].mcpServerConfig = { headers: { 'X-Api-Key': 'untrusted-archive-substitution' } };
    await target.service.importArchive(owner, archive, 'overwrite');
    expect(target.rows.get(targetId)!.runtimeAuthConfig).toEqual(existing.runtimeAuthConfig);
    expect(target.rows.get(targetId)!.dynamicHeaders).toEqual(existing.dynamicHeaders);
    expect(target.rows.get(targetId)!.mcpServerConfig).toEqual(existing.mcpServerConfig);
  });

  it('does not downgrade an encrypted target to plaintext credential configuration', async () => {
    const target = fixture('b2');
    target.rows.set(targetId, { ...target.source, id: targetId });
    const archive = target.service.parseArchive((await target.service.exportConnectors(owner,
      { selection: 'all', includeSecurity: false })).buffer);
    archive.connectors[0].runtimeAuthConfig = { strategy: 'custom_headers', headerMappings: { Authorization: 'untrusted' } };
    await expect(target.service.importArchive(owner, archive, 'overwrite')).rejects.toThrow();
    expect(target.store.update).not.toHaveBeenCalled();
  });

  it('fences an ordinary overwrite against a concurrent credential/destination replacement', async () => {
    const target = fixture('b2');
    const original = { ...target.source, id: targetId,
      runtimeAuthConfig: sealConnectorHeaders(target.crypto, target.config, targetId, endpoint, { 'X-Api-Key': canary }) };
    target.rows.set(targetId, original);
    const archive = target.service.parseArchive((await target.service.exportConnectors(owner,
      { selection: 'all', includeSecurity: false })).buffer);
    const nextUrl = 'https://replacement.example.test/mcp';
    const concurrent = { ...original, securityRevision: 2, mcpServerUrl: nextUrl,
      runtimeAuthConfig: sealConnectorHeaders(target.crypto, target.config, targetId, nextUrl, { 'X-Api-Key': 'replacement-token' }) };
    target.store.findBySlugAndOwner.mockImplementationOnce(async () => {
      target.rows.set(targetId, concurrent); return original;
    });
    // Invoke the connector phase directly so this concurrency fixture does not
    // incorrectly roll back a separate simulated transaction's committed row.
    const apply = (target.service as unknown as { importConnectors(...args: unknown[]): Promise<void> })
      .importConnectors.bind(target.service);
    await expect(apply(archive.connectors, owner, new Map(), new Map(), 'overwrite',
      { connectors: { created: 0, updated: 0, skipped: 0 } })).rejects.toThrow();
    expect(target.store.update.mock.calls[0][2]).toBe(1);
    expect(target.rows.get(targetId)).toEqual(concurrent);
  });

  it('separates current security permission from revision fencing through the real controller and service', async () => {
    const target = fixture('b2');
    const trusted = { ...target.source, id: targetId, runtimeAuthConfig: {}, mcpSecurityPolicy: {
      ...target.source.mcpSecurityPolicy, profile: 'internal_jwt', actorDelegation: 'verified_user', audience: 'mcp-agent' } };
    target.rows.set(targetId, trusted);
    const archive = target.service.parseArchive((await target.service.exportConnectors(owner,
      { selection: 'all', includeSecurity: false })).buffer);
    archive.connectors[0].mcpServerUrl = 'https://attacker.example.test/mcp';
    const audit = { logSuccess: jest.fn() };
    const controller = new AdminCatalogTransferController(target.service, audit as never);
    const file = { originalname: 'catalog.json', buffer: Buffer.from(JSON.stringify(archive)) };
    const user = { _id: owner, permissions: [Permissions.CONNECTORS_CREATE, Permissions.CONNECTORS_UPDATE] };
    const request = { ip: '127.0.0.1', headers: {} };
    await expect(controller.importCatalog(file, { conflictPolicy: 'overwrite' }, user as never, request as never)).rejects.toThrow();
    expect(target.store.update).not.toHaveBeenCalled();
    expect(target.rows.get(targetId)).toEqual(trusted);
    expect(audit.logSuccess).not.toHaveBeenCalled();
    await expect(controller.importCatalog(file, { conflictPolicy: 'overwrite' },
      { ...user, permissions: [...user.permissions, Permissions.CONNECTORS_SECURITY_MANAGE] } as never,
      request as never)).resolves.toMatchObject({ connectors: { updated: 1 } });
    expect(target.store.update.mock.calls[0][2]).toBe(1);
  });
});
