import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConnectorController } from './connector.controller';
import { AdminConnectorController } from './admin-connector.controller';
import { ConnectorService } from './connector.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorTransferService } from './connector-transfer.service';
import { ConnectorUserService } from './connector-user.service';
import { ConnectorAdminAuthService } from './services/connector-admin-auth.service';
import { McpJwtService } from './services/mcp-jwt.service';
import { ConnectedAppOAuthService } from '../connected-app/services/connected-app-oauth.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Permissions } from '../authorization/constants/permissions';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@common/services/crypto.service';

/** Auth is supplied by the fixture; this suite tests the real HTTP serialization boundary. */
describe('R03 serialized connector HTTP boundary', () => {
  let app: INestApplication;
  const canary = 'TEST_CANARY_R03';
  const endpoint = `https://mcp.example.test/mcp?arbitrary=${canary}#${canary}`;
  const row = { id: 'connector-1', slug: 'legacy', name: 'Legacy', description: `Imported from ${endpoint}`,
    mcpServerUrl: endpoint, mcpTransportType: 'streamable_http', authSourceType: 'credential',
    authType: 'none', authConfigSchema: { nested: { default: canary } },
    actions: [{ key: 'search', label: 'Search', description: canary, isEnabled: true,
      parameterSchema: { properties: { query: { type: 'string', default: canary } } } }],
    runtimeAuthConfig: { headerPrefix: canary }, mcpServerConfig: { env: { KEY: canary } },
    isActive: true, createdBy: 'actor-1', createdAt: new Date(), updatedAt: new Date(),
  };
  const store = { findById: jest.fn().mockResolvedValue(row), list: jest.fn().mockResolvedValue({ rows: [row], total: 1 }),
    findAllActiveVisible: jest.fn().mockResolvedValue([row]), insert: jest.fn(), update: jest.fn() };
  const audit = { logSuccess: jest.fn() };
  let granted: string[] = Object.values(Permissions);
  const migrationPlan = { expectedSecurityRevision: 1,
    mappings: [{ queryKey: 'token', headerName: 'X-Api-Key', prefix: '' }], removeQueryKeys: ['mode'] };

  beforeAll(async () => {
    const config = new ConfigService({ app: { encryptionKey: 'd4'.repeat(32) } });
    const service = new ConnectorService(store as never, {} as never,
      { setContext: jest.fn(), log: jest.fn() } as never, {} as never,
      {} as never, {} as never, config, undefined, new CryptoService(config));
    // The real ConfigService returns the caller-supplied default for an unset key
    // (MCP_WORKSPACE_SCOPE_TTL_SECONDS defaults to 180); honour it like the service does.
    const jwt = new McpJwtService({ get: (_key: string, defaultValue?: unknown) => defaultValue } as never,
      {} as never, store as never, {} as never);
    const module = await Test.createTestingModule({
      controllers: [ConnectorController, AdminConnectorController],
      providers: [
        { provide: ConnectorService, useValue: service },
        { provide: McpJwtService, useValue: jwt },
        { provide: AuditLogService, useValue: audit },
        ...[ConnectorCredentialService, ConnectorTransferService, ConnectorUserService,
          ConnectedAppOAuthService, ConnectorAdminAuthService, 'ConnectorAuthService']
          .map(provide => ({ provide, useValue: {} })),
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { _id: 'actor-1', permissions: granted };
      next();
    });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    granted = Object.values(Permissions);
    store.findById.mockReset().mockResolvedValue(row);
    store.update.mockReset(); store.insert.mockClear(); audit.logSuccess.mockClear();
  });

  it.each(['connectors', 'connectors/connector-1', 'admin/connectors', 'admin/connectors/connector-1'])
  ('does not serialize legacy URL credentials via %s', async route => {
    const response = await fetch(`${await app.getUrl()}/api/v1/${route}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(canary);
    expect(text).not.toContain('runtimeAuthConfig');
    expect(text).not.toContain('mcpServerConfig');
    expect(text).toContain('https://mcp.example.test/mcp');
  });

  it.each([
    ['not-an-endpoint?token=TEST_CANARY_R03', 'not-an-endpoint?token=TEST_CANARY_R03'],
    ['https://user:TEST_CANARY_R03@[invalid/mcp', 'TEST_CANARY_R03'],
    [endpoint, `${[...canary].map(char => `%${char.charCodeAt(0).toString(16)}`).join('')}%ZZ`],
    [endpoint, `${[...canary].map(char => `%${char.charCodeAt(0).toString(16)}`).join('')}%FF`],
    [endpoint, `${[...canary].map(char => `%${char.charCodeAt(0).toString(16)}`).join('')}%E2%82`],
  ])('fails closed for malformed historical endpoints and partially encoded metadata', async (legacyEndpoint, description) => {
    const previous = { mcpServerUrl: row.mcpServerUrl, description: row.description };
    Object.assign(row, { mcpServerUrl: legacyEndpoint, description });
    try {
      for (const route of ['connectors', 'connectors/connector-1', 'admin/connectors', 'admin/connectors/connector-1']) {
        const response = await fetch(`${await app.getUrl()}/api/v1/${route}`);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(canary);
        expect(text).not.toContain('%54%45%53%54');
        expect(text).not.toContain('not-an-endpoint');
      }
    } finally { Object.assign(row, previous); }
  });

  it('denies a legacy query endpoint on the browser token route without echoing it', async () => {
    const response = await fetch(`${await app.getUrl()}/api/v1/connectors/mcp-token/connector-1`, { method: 'POST' });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(canary);
    expect(text).not.toContain('serverUrl');
  });

  it.each(['admin/connectors', 'admin/connectors/import-mcp'])
  ('denies unsafe writes without persistence or secret-bearing audit at %s', async route => {
    const response = await fetch(`${await app.getUrl()}/api/v1/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new', name: 'New', mcpServerUrl: endpoint,
        serverUrl: endpoint, transportType: 'streamable_http' }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(canary);
    expect(store.insert).not.toHaveBeenCalled();
    expect(audit.logSuccess).not.toHaveBeenCalled();
  });

  it('migrates through the real admin route with secret-free serialized response and audit', async () => {
    const legacy = { ...row, authSourceType: 'none', runtimeAuthConfig: {}, mcpServerConfig: {},
      mcpServerUrl: `https://mcp.example.test/mcp?token=${canary}&mode=read`, securityRevision: 1, actions: [] };
    store.findById.mockResolvedValue(legacy);
    store.update.mockImplementation(async (_id: string, patch: object, revision: number) =>
      ({ ...legacy, ...patch, securityRevision: revision + 1 }));
    const response = await fetch(`${await app.getUrl()}/api/v1/admin/connectors/connector-1/migrate-query-headers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(migrationPlan),
    });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain(canary);
    expect(text).not.toContain('encryptedHeaders');
    expect(text).not.toContain('runtimeAuthConfig');
    expect(text).toContain('https://mcp.example.test/mcp');
    expect(JSON.stringify(audit.logSuccess.mock.calls)).not.toContain(canary);
    expect(audit.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ metadata: {
      credentialMigration: 'query-to-encrypted-headers', headerCount: 1, securityRevision: 2 } }));
  });

  it.each([Permissions.CONNECTORS_UPDATE, Permissions.CONNECTORS_SECURITY_MANAGE])
    ('requires both permissions at the admin HTTP guard, not only %s', async permission => {
      granted = [permission];
      const response = await fetch(`${await app.getUrl()}/api/v1/admin/connectors/connector-1/migrate-query-headers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(migrationPlan),
      });
      expect(response.status).toBe(403);
      expect(store.findById).not.toHaveBeenCalled();
      expect(store.update).not.toHaveBeenCalled();
      expect(audit.logSuccess).not.toHaveBeenCalled();
    });

  it.each([
    { expectedSecurityRevision: '1' }, { expectedSecurityRevision: -1 },
    { mappings: [{ queryKey: 'token', headerName: 'X-Api-Key' }] },
    { mappings: [{ ...migrationPlan.mappings[0], secret: 'unexpected-field' }] },
    { removeQueryKeys: 'mode' },
  ])('validates explicit migration fields before store access: %j', async invalid => {
    const response = await fetch(`${await app.getUrl()}/api/v1/admin/connectors/connector-1/migrate-query-headers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...migrationPlan, ...invalid }),
    });
    expect(response.status).toBe(400);
    expect(store.findById).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });
});
