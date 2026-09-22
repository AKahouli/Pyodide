import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { PgUserStore } from '@modules/user/persistence/pg-user.store';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import {
  PgAuthProviderStore,
  PgOAuthStateStore,
  PgProviderLinkTokenStore,
  PgUserProviderLinkStore,
} from './pg-auth-provider.stores';
import type { AuthProviderRecord } from './auth-provider.stores';

describeIntegration('Pg auth-provider stores (integration)', () => {
  const { db, close } = makeTestDb();
  const typedDb = db as NodePgDatabase<typeof schema>;
  const providers = new PgAuthProviderStore(typedDb);
  const states = new PgOAuthStateStore(typedDb);
  const tokens = new PgProviderLinkTokenStore(typedDb);
  const links = new PgUserProviderLinkStore(typedDb);
  const users = new PgUserStore(typedDb);
  const tag = newObjectId().slice(-8);
  const providerIds: string[] = [];
  const stateValues: string[] = [];
  const tokenValues: string[] = [];
  const userIds: string[] = [];
  const linkProviderKeys: string[] = [];

  const providerInit = (suffix: string, over: Partial<AuthProviderRecord> = {}): Omit<AuthProviderRecord, 'id' | 'createdAt' | 'updatedAt'> => ({
    providerKey: `spec-${tag}-${suffix}`,
    displayName: 'Spec',
    clientId: 'cid',
    clientSecret: 'secret',
    tenantId: null,
    authorizationUrl: 'https://idp.example/auth',
    tokenUrl: 'https://idp.example/token',
    userinfoUrl: 'https://idp.example/userinfo',
    scopes: ['openid', 'email'],
    iconKey: null,
    sortOrder: 0,
    pkceEnabled: true,
    enabled: true,
    ...over,
  });
  const mkProvider = async (suffix: string, over: Partial<AuthProviderRecord> = {}) => {
    const p = await providers.create(providerInit(suffix, over));
    providerIds.push(p.id);
    return p;
  };
  const mkUser = async () => {
    const u = await users.create({ email: `spec-ap-${newObjectId().slice(-8)}@example.com`, passwordHash: 'h', emailVerified: true, status: 'active' });
    userIds.push(u.id);
    return u;
  };
  const mkState = async (suffix: string, expiresInMs: number) => {
    const state = `spec-${tag}-${suffix}`;
    stateValues.push(state);
    return states.create({ state, providerKey: `spec-${tag}-p`, codeVerifier: 'v', returnUrl: '/x', expiresAt: new Date(Date.now() + expiresInMs) });
  };

  afterAll(async () => {
    if (linkProviderKeys.length) await db.delete(schema.identityUserProviderLinks).where(inArray(schema.identityUserProviderLinks.providerKey, linkProviderKeys));
    if (tokenValues.length) await db.delete(schema.identityProviderLinkTokens).where(inArray(schema.identityProviderLinkTokens.token, tokenValues));
    if (stateValues.length) await db.delete(schema.identityOauthStates).where(inArray(schema.identityOauthStates.state, stateValues));
    if (providerIds.length) await db.delete(schema.identityAuthProviders).where(inArray(schema.identityAuthProviders.id, providerIds));
    if (userIds.length) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, userIds));
    await close();
  });

  describe('PgAuthProviderStore', () => {
    it('supports CRUD and lookups', async () => {
      const p = await mkProvider('crud', { sortOrder: 5 });
      expect((await providers.findById(p.id))?.providerKey).toBe(p.providerKey);
      expect((await providers.findByKey(p.providerKey))?.id).toBe(p.id);
      expect(await providers.findById('bad')).toBeNull();

      const updated = await providers.update(p.id, { displayName: 'Renamed', enabled: false, scopes: ['x'] });
      expect(updated).toMatchObject({ displayName: 'Renamed', enabled: false, scopes: ['x'] });
      expect((await providers.findAllEnabled()).some((r) => r.id === p.id)).toBe(false);
      expect((await providers.findAll()).some((r) => r.id === p.id)).toBe(true);
      expect(await providers.update(newObjectId(), { displayName: 'x' })).toBeNull();

      expect(await providers.deleteById(p.id)).toBe(true);
      expect(await providers.deleteById(p.id)).toBe(false);
      expect(await providers.findByKey(p.providerKey)).toBeNull();
    });

    it('enforces a unique providerKey and existsByKey honours excludeId', async () => {
      const p = await mkProvider('uniq');
      await expect(providers.create(providerInit('uniq'))).rejects.toThrow();
      expect(await providers.existsByKey(p.providerKey)).toBe(true);
      expect(await providers.existsByKey(p.providerKey, p.id)).toBe(false);
      expect(await providers.existsByKey(`spec-${tag}-missing`)).toBe(false);
    });
  });

  describe('PgOAuthStateStore', () => {
    it('consumeByState is one-shot', async () => {
      const s = await mkState('once', 60_000);
      const first = await states.consumeByState(s.state);
      expect(first).toMatchObject({ id: s.id, codeVerifier: 'v', returnUrl: '/x' });
      expect(await states.consumeByState(s.state)).toBeNull();
    });

    it('does not consume an expired state (and leaves the row for TTL cleanup)', async () => {
      const s = await mkState('expired', -1_000);
      expect(await states.consumeByState(s.state)).toBeNull();
      const rows = await db.select().from(schema.identityOauthStates).where(inArray(schema.identityOauthStates.state, [s.state]));
      expect(rows).toHaveLength(1);
    });

    it('unknown state returns null', async () => {
      expect(await states.consumeByState(`spec-${tag}-unknown`)).toBeNull();
    });

    // 6.3(b): real parallelism on separate pool connections.
    it('two parallel consumers of one state: exactly one gets the row', async () => {
      const s = await mkState('race', 60_000);
      const results = await Promise.all([states.consumeByState(s.state), states.consumeByState(s.state), states.consumeByState(s.state)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });
  });

  describe('PgProviderLinkTokenStore', () => {
    const mkToken = async (suffix: string, providerKey: string, expiresInMs: number) => {
      const user = await mkUser();
      const token = `spec-${tag}-${suffix}`;
      tokenValues.push(token);
      return tokens.create({ token, userId: user.id, providerKey, providerUserId: 'pu', providerEmail: 'p@example.com', expiresAt: new Date(Date.now() + expiresInMs) });
    };

    it('consumeByToken is one-shot and expiry-strict', async () => {
      const t = await mkToken('t1', 'gh', 60_000);
      expect((await tokens.consumeByToken(t.token))?.id).toBe(t.id);
      expect(await tokens.consumeByToken(t.token)).toBeNull();

      const expired = await mkToken('t2', 'gh', -1_000);
      expect(await tokens.consumeByToken(expired.token)).toBeNull();
    });

    it('consumeByTokenAndProviderKey requires the matching provider and keeps the token otherwise', async () => {
      const t = await mkToken('t3', 'gh', 60_000);
      expect(await tokens.consumeByTokenAndProviderKey(t.token, 'other')).toBeNull();
      expect((await tokens.consumeByTokenAndProviderKey(t.token, 'gh'))?.id).toBe(t.id);
      expect(await tokens.consumeByTokenAndProviderKey(t.token, 'gh')).toBeNull();
    });

    it('two parallel consumers of one token: exactly one wins', async () => {
      const t = await mkToken('t4', 'gh', 60_000);
      const results = await Promise.all([tokens.consumeByToken(t.token), tokens.consumeByToken(t.token)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });
  });

  describe('PgUserProviderLinkStore', () => {
    const key = `spec-${tag}-lk`;
    const key2 = `spec-${tag}-lk2`;
    const link = (userId: string, providerKey: string, providerUserId: string) =>
      links.create({ userId, providerKey, providerUserId, providerEmail: 'x@example.com', linkedAt: new Date() });

    beforeAll(() => { linkProviderKeys.push(key, key2); });

    it('enforces unique (provider_key, provider_user_id) across users', async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      await link(a.id, key, 'pu-1');
      await expect(link(b.id, key, 'pu-1')).rejects.toThrow();
      // Same provider user id under another provider is fine.
      await expect(link(b.id, key2, 'pu-1')).resolves.toBeDefined();
      expect((await links.findByProvider(key, 'pu-1'))?.userId).toBe(a.id);
    });

    it('lists, counts and deletes links', async () => {
      const u = await mkUser();
      await link(u.id, key, 'pu-2');
      await link(u.id, key2, 'pu-3');
      expect((await links.findByUserId(u.id)).map((l) => l.providerKey).sort()).toEqual([key, key2].sort());
      expect(await links.countByUserExcluding(u.id, key)).toBe(1);
      expect(await links.countByProviderKey(key2)).toBeGreaterThanOrEqual(1);
      expect(await links.deleteByUserAndProvider(u.id, key)).toBe(true);
      expect(await links.deleteByUserAndProvider(u.id, key)).toBe(false);
      expect(await links.findByUserId('bad')).toEqual([]);
    });

    it('deleteAllByProviderKey removes every link of that provider only', async () => {
      const u = await mkUser();
      await link(u.id, key, 'pu-4');
      const removed = await links.deleteAllByProviderKey(key);
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(await links.countByProviderKey(key)).toBe(0);
    });
  });
});
