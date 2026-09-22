import { ConnectorAdminAuthService } from './connector-admin-auth.service';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import {
  CONNECTOR_ADMIN_AUTH_STORE,
  CONNECTOR_ADMIN_OAUTH_STATE_STORE,
  type ConnectorAdminAuthStore,
} from '../persistence/connector.store';
import { PgConnectorAdminAuthStore, PgConnectorAdminOauthStateStore } from '../persistence/pg-connector.store';
import * as schema from '@modules/postgres/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

jest.setTimeout(60000);

/**
 * Admin twin of the user-connection single-flight spec, plus the R-06
 * regression tests: a failing refresh must leave the terminal status
 * (`error`/`expired`) committed instead of rolled back with the transaction.
 */
describeIntegration('ConnectorAdminAuthService refresh (integration)', () => {
  const { db, close } = makeTestDb();
  const authStore: ConnectorAdminAuthStore = new PgConnectorAdminAuthStore(db as never);
  const service = new ConnectorAdminAuthService(
    new PgConnectorAdminOauthStateStore(db as never),
    authStore,
    db as unknown as NodePgDatabase<typeof schema>,
    {
      encrypt: (v: string) => `enc:${v}`,
      decrypt: (v: string) => v.replace(/^enc:/, ''),
    } as never,
    { get: () => 'http://localhost.test' } as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
    {
      findByKey: async () => ({
        appKey: 'microsoft365',
        authorizationUrl: 'https://auth',
        tokenUrl: 'https://token.example.test',
        clientId: 'client',
        clientSecret: 'secret',
        scopes: [],
        pkceEnabled: false,
      }),
    } as never,
  );

  const USER = 'admin-user-1';
  const APP = 'microsoft365';

  const row = async () => (await authStore.findByUserAndApp(USER, APP))!;

  beforeEach(async () => {
    // fk on app_key requires the definition to exist.
    await db.execute(
      `INSERT INTO integrations.connected_app_definitions
         (id, app_key, display_name, authorization_url, token_url, client_id, client_secret, scopes)
       VALUES ('msdef0000000000000000ff', 'microsoft365', 'M365', 'https://auth', 'https://token', 'c', 's', '{}')
       ON CONFLICT (app_key) DO NOTHING`,
    );
    await authStore.upsertOnCallback(USER, APP, {
      accessToken: 'enc:expired-access',
      refreshToken: 'enc:refresh-token',
      tokenExpiresAt: new Date(Date.now() - 60_000),
      scopes: [],
    });
  });

  afterEach(async () => {
    await db.execute(`DELETE FROM integrations.admin_connector_auth_tokens WHERE user_id = '${USER}' AND app_key = '${APP}'`);
  });

  afterAll(async () => close());

  it('refreshes exactly once when 5 callers race an expired token', async () => {
    const fetchMock = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        ok: true,
        json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
      } as unknown as Response;
    });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    try {
      const tokens = await Promise.all(
        Array.from({ length: 5 }, () => service.getValidToken(USER, APP)),
      );

      for (const token of tokens) expect(token).toBe('new-access');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('a provider 400 rejects the call AND persists status=error (R-06)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return { ok: false, status: 400, text: async () => 'invalid_grant' } as unknown as Response;
    });

    try {
      await expect(service.getValidToken(USER, APP)).rejects.toThrow();
      expect((await row()).status).toBe('error');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('a missing refresh token rejects the call AND persists status=expired (R-06)', async () => {
    await db.execute(
      `UPDATE integrations.admin_connector_auth_tokens SET refresh_token = NULL WHERE user_id = '${USER}' AND app_key = '${APP}'`,
    );

    await expect(service.getValidToken(USER, APP)).rejects.toThrow();
    expect((await row()).status).toBe('expired');
  });
});
