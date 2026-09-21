import { ConnectedAppTokenService } from './connected-app-token.service';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { USER_APP_CONNECTION_STORE, type UserAppConnectionStore } from '../persistence/connected-app.store';
import { PgUserAppConnectionStore } from '../persistence/pg-connected-app.store';
import * as schema from '@modules/postgres/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

jest.setTimeout(60000);

/**
 * Plan 3.2 ⚑ single-flight refresh against a real database: the row lock
 * (SELECT … FOR UPDATE) must serialize concurrent callers so N racing
 * getValidToken calls on an expired token trigger exactly ONE provider call.
 */
describeIntegration('ConnectedAppTokenService single-flight refresh (integration)', () => {
  const { db, close } = makeTestDb();
  const store: UserAppConnectionStore = new PgUserAppConnectionStore(db as never);
  const service = new ConnectedAppTokenService(
    store,
    db as unknown as NodePgDatabase<typeof schema>,
    {
      findByKey: async () => ({
        appKey: 'microsoft365',
        tokenUrl: 'https://token.example.test',
        clientId: 'client',
        clientSecret: 'secret',
        scopes: [],
        pkceEnabled: false,
        enabled: true,
      }),
    } as never,
    {
      encrypt: (v: string) => `enc:${v}`,
      decrypt: (v: string) => v.replace(/^enc:/, ''),
    } as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  );

  let connectionId: string;

  beforeEach(async () => {
    // fk_user_app_connections_app_key requires the definition to exist.
    await db.execute(
      `INSERT INTO integrations.connected_app_definitions
         (id, app_key, display_name, authorization_url, token_url, client_id, client_secret, scopes)
       VALUES ('msdef0000000000000000ff', 'microsoft365', 'M365', 'https://auth', 'https://token', 'c', 's', '{}')
       ON CONFLICT (app_key) DO NOTHING`,
    );
    const row = await store.upsertOnCallback('user-1', 'microsoft365', {
      accessToken: 'enc:expired-access',
      refreshToken: 'enc:refresh-token',
      tokenExpiresAt: new Date(Date.now() - 60_000),
      scopes: [],
      status: 'active' as never,
    });
    connectionId = row.id;
  });

  afterEach(async () => {
    await db.execute(`DELETE FROM integrations.user_app_connections WHERE id = '${connectionId}'`);
  });

  afterAll(async () => close());

  it('refreshes exactly once when 5 callers race an expired token', async () => {
    const fetchMock = jest.fn(async () => {
      // Provider latency so all 5 callers pile into the refresh path.
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        ok: true,
        json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
      } as unknown as Response;
    });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    try {
      const tokens = await Promise.all(
        Array.from({ length: 5 }, () => service.getValidToken('user-1', 'microsoft365')),
      );

      // Every caller ends up with the fresh token…
      for (const token of tokens) expect(token).toBe('new-access');
      // …and the provider was hit exactly once (4 losers re-checked under the lock).
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const fresh = await store.findByIdForUpdate(connectionId);
      expect(fresh!.accessToken).toBe('enc:new-access');
      expect(fresh!.refreshToken).toBe('enc:new-refresh');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('does not call the provider while the token is still valid', async () => {
    await store.updateById(connectionId, {
      accessToken: 'enc:valid-access',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    });

    const fetchMock = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    try {
      await expect(service.getValidToken('user-1', 'microsoft365')).resolves.toBe('valid-access');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });
});
