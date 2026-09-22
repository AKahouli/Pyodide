import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { CatalogTransferService } from './catalog-transfer.service';
import { PgUserAppConnectionStore } from '../../connected-app/persistence/pg-connected-app.store';
import { PgConnectorAdminAuthStore } from '../persistence/pg-connector.store';
import { PgUserStore } from '../../user/persistence/pg-user.store';
import type { NewUser } from '../../user/persistence/user.store';
import type { CatalogArchiveV1, CatalogImportResult } from '../interfaces/catalog-transfer.interface';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

jest.setTimeout(60000);

const APP_KEY = 'microsoft365';
const DEFINITION_ID = 'msdef0000000000000000ff';

/**
 * R-13: the security import overwrite path must build an explicit column
 * patch — never spread the archive record (its ids/keys would leak into the
 * UPDATE) and never fabricate a Types.ObjectId userId.
 */
describeIntegration('CatalogTransferService security import overwrite (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, '') };
  const noop = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const appConnectionStore = new PgUserAppConnectionStore(db as never);
  const adminAuthStore = new PgConnectorAdminAuthStore(db as never);
  const service = new CatalogTransferService(
    {} as never, {} as never, {} as never, adminAuthStore, {} as never, {} as never,
    {} as never, appConnectionStore, db as unknown as NodePgDatabase<typeof schema>, crypto as never,
  );
  let userId: string;

  const result = (): CatalogImportResult => ({
    skills: { created: 0, updated: 0, skipped: 0 },
    connectors: { created: 0, updated: 0, skipped: 0 },
    categories: { created: 0, reused: 0 },
    security: { credentials: 0, connectedApps: 0, tokens: 0 },
  });

  const archive = (): CatalogArchiveV1 => ({
    format: 'yellowstorm-catalog',
    version: 1,
    resource: 'connectors',
    exportedAt: new Date().toISOString(),
    securityIncluded: true,
    connectorCategories: [],
    skillCategories: [],
    skills: [],
    connectors: [],
    security: {
      connectorCredentials: [],
      connectedAppDefinitions: [],
      userAppConnections: [{
        appKey: APP_KEY,
        accessToken: 'plain-new-access',
        refreshToken: 'plain-new-refresh',
        tokenExpiresAt: null,
        scopes: ['mail.read'],
        providerAccountId: 'acct-1',
        providerEmail: 'imported@example.test',
        status: 'active',
        lastUsedAt: null,
        lastRefreshedAt: null,
        errorMessage: '',
      }],
      adminConnectorAuth: [{
        appKey: APP_KEY,
        accessToken: 'plain-admin-access',
        refreshToken: 'plain-admin-refresh',
        tokenExpiresAt: null,
        scopes: ['admin.scope'],
        providerAccountId: 'admin-acct-1',
        providerEmail: 'admin@example.test',
        connected: true,
        status: 'active',
        disconnectedAt: null,
        lastUsedAt: null,
        lastRefreshedAt: null,
        errorMessage: '',
      }],
    },
  });

  beforeEach(async () => {
    await db.execute(
      `INSERT INTO integrations.connected_app_definitions
         (id, app_key, display_name, authorization_url, token_url, client_id, client_secret, scopes)
       VALUES ('${DEFINITION_ID}', '${APP_KEY}', 'M365', 'https://auth', 'https://token', 'c', 's', '{}')
       ON CONFLICT (app_key) DO NOTHING`,
    );
    const user = await new PgUserStore(db as never).create({
      email: `import-${oid().slice(-8)}@example.com`,
      passwordHash: 'hash',
      emailVerified: true,
      status: 'active',
    } satisfies NewUser);
    userId = user.id;
  });

  afterEach(async () => {
    await db.execute(`DELETE FROM integrations.user_app_connections WHERE user_id = '${userId}'`);
    await db.execute(`DELETE FROM integrations.admin_connector_auth_tokens WHERE user_id = '${userId}'`);
    await db.execute(`DELETE FROM identity.users WHERE id = '${userId}'`);
  });

  afterAll(async () => { await close(); });

  it('overwrites an existing admin-auth record with explicit columns and keeps ownership', async () => {
    await adminAuthStore.upsertOnCallback(userId, APP_KEY, {
      accessToken: 'enc:old-access',
      refreshToken: 'enc:old-refresh',
      tokenExpiresAt: null,
      scopes: [],
    });

    await (service as unknown as {
      importSecurity(archive: CatalogArchiveV1, ownerId: Types.ObjectId, policy: string, result: CatalogImportResult): Promise<void>;
    }).importSecurity(archive(), new Types.ObjectId(userId), 'overwrite', result());

    const rows = await db.select().from(schema.integrationsAdminConnectorAuthTokens);
    const mine = rows.filter((r) => r.userId === userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].appKey).toBe(APP_KEY);
    expect(mine[0].accessToken).toBe('enc:plain-admin-access');
    expect(mine[0].scopes).toEqual(['admin.scope']);
    expect(mine[0].connected).toBe(true);
  });

  it('insertForImport on a (user, app) conflict returns the existing row intact', async () => {
    const first = await appConnectionStore.insertForImport(userId, APP_KEY, {
      accessToken: 'enc:first',
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: [],
      status: 'active' as never,
    });
    const second = await appConnectionStore.insertForImport(userId, APP_KEY, {
      accessToken: 'enc:second',
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: [],
      status: 'active' as never,
    });

    expect(second.id).toBe(first.id);
    expect(second.userId).toBe(userId);
    expect(second.accessToken).toBe('enc:first');
  });
});
