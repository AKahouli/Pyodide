import {   
  type AuthProviderRecord,    
  type AuthProviderStore,    
  type OAuthStateRecord,    
  type OAuthStateStore,    
  type ProviderLinkTokenRecord,    
  type ProviderLinkTokenStore,    
  type UserProviderLinkRecord,    
  type UserProviderLinkStore,    
} from './auth-provider.stores';

const oid = (): string => [...Array(24)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

export function providerRecord(overrides: Partial<AuthProviderRecord> = {}): AuthProviderRecord {
  return {
    id: oid(),
    providerKey: 'microsoft',
    displayName: 'Microsoft',
    clientId: 'enc-client-id',
    clientSecret: 'enc-client-secret',
    tenantId: null,
    authorizationUrl: 'https://login.example/authorize',
    tokenUrl: 'https://login.example/token',
    userinfoUrl: 'https://login.example/userinfo',
    scopes: ['openid', 'email', 'profile'],
    iconKey: 'microsoft',
    sortOrder: 0,
    pkceEnabled: true,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export interface AuthProviderStoreFake extends AuthProviderStore {
  records: AuthProviderRecord[];
}

export function makeProviderStoreFake(seed: AuthProviderRecord[] = []): AuthProviderStoreFake {
  const records = [...seed];
  return {
    records,
    findAll: jest.fn(async () => [...records].sort((a, b) => a.sortOrder - b.sortOrder)),
    findAllEnabled: jest.fn(async () => records.filter((r) => r.enabled).sort((a, b) => a.sortOrder - b.sortOrder)),
    findById: jest.fn(async (id: string) => records.find((r) => r.id === id) ?? null),
    findByKey: jest.fn(async (key: string) => records.find((r) => r.providerKey === key) ?? null),
    existsByKey: jest.fn(async (key: string, excludeId?: string) =>
      records.some((r) => r.providerKey === key && r.id !== excludeId)),
    create: jest.fn(async (init) => {
      const created = providerRecord({ ...init, id: oid() });
      records.push(created);
      return created;
    }),
    update: jest.fn(async (id: string, patch) => {
      const target = records.find((r) => r.id === id);
      if (!target) return null;
      Object.assign(target, patch);
      return target;
    }),
    deleteById: jest.fn(async (id: string) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx >= 0) {
        records.splice(idx, 1);
        return true;
      }
      return false;
    }),
  };
}

export function stateRecord(overrides: Partial<OAuthStateRecord> = {}): OAuthStateRecord {
  return {
    id: oid(),
    state: 'state-1',
    providerKey: 'microsoft',
    codeVerifier: null,
    returnUrl: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export interface OAuthStateStoreFake extends OAuthStateStore {
  records: OAuthStateRecord[];
}

export function makeOAuthStateStoreFake(seed: OAuthStateRecord[] = []): OAuthStateStoreFake {
  const records = [...seed];
  return {
    records,
    create: jest.fn(async (init) => {
      const created = stateRecord({ ...init, id: oid() });
      records.push(created);
      return created;
    }),
    consumeByState: jest.fn(async (state: string) => {
      const idx = records.findIndex((r) => r.state === state && r.expiresAt > new Date());
      if (idx < 0) return null;
      const [record] = records.splice(idx, 1);
      return record;
    }),
  };
}

export function linkTokenRecord(overrides: Partial<ProviderLinkTokenRecord> = {}): ProviderLinkTokenRecord {
  return {
    id: oid(),
    token: 'token-1',
    userId: oid(),
    providerKey: 'microsoft',
    providerUserId: 'sub-1',
    providerEmail: 'jane@acme.io',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export interface ProviderLinkTokenStoreFake extends ProviderLinkTokenStore {
  records: ProviderLinkTokenRecord[];
}

export function makeProviderLinkTokenStoreFake(seed: ProviderLinkTokenRecord[] = []): ProviderLinkTokenStoreFake {
  const records = [...seed];
  return {
    records,
    create: jest.fn(async (init) => {
      const created = linkTokenRecord({ ...init, id: oid() });
      records.push(created);
      return created;
    }),
    consumeByToken: jest.fn(async (token: string) => {
      const idx = records.findIndex((r) => r.token === token && r.expiresAt > new Date());
      if (idx < 0) return null;
      const [record] = records.splice(idx, 1);
      return record;
    }),
    consumeByTokenAndProviderKey: jest.fn(async (token: string, providerKey: string) => {
      const idx = records.findIndex((r) => r.token === token && r.providerKey === providerKey && r.expiresAt > new Date());
      if (idx < 0) return null;
      const [record] = records.splice(idx, 1);
      return record;
    }),
  };
}

export function linkRecord(overrides: Partial<UserProviderLinkRecord> = {}): UserProviderLinkRecord {
  return {
    id: oid(),
    userId: oid(),
    providerKey: 'microsoft',
    providerUserId: 'sub-1',
    providerEmail: 'jane@acme.io',
    linkedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export interface UserProviderLinkStoreFake extends UserProviderLinkStore {
  records: UserProviderLinkRecord[];
}

export function makeUserProviderLinkStoreFake(seed: UserProviderLinkRecord[] = []): UserProviderLinkStoreFake {
  const records = [...seed];
  return {
    records,
    findByProvider: jest.fn(async (providerKey: string, providerUserId: string) =>
      records.find((r) => r.providerKey === providerKey && r.providerUserId === providerUserId) ?? null),
    findByUserId: jest.fn(async (userId: string) => records.filter((r) => r.userId === userId)),
    create: jest.fn(async (init) => {
      const created = linkRecord({ ...init, id: oid() });
      records.push(created);
      return created;
    }),
    deleteByUserAndProvider: jest.fn(async (userId: string, providerKey: string) => {
      const idx = records.findIndex((r) => r.userId === userId && r.providerKey === providerKey);
      if (idx < 0) return false;
      records.splice(idx, 1);
      return true;
    }),
    countByUserExcluding: jest.fn(async (userId: string, providerKey: string) =>
      records.filter((r) => r.userId === userId && r.providerKey !== providerKey).length),
    countByProviderKey: jest.fn(async (providerKey: string) =>
      records.filter((r) => r.providerKey === providerKey).length),
    deleteAllByProviderKey: jest.fn(async (providerKey: string) => {
      const before = records.length;
      for (let i = records.length - 1; i >= 0; i -= 1) if (records[i].providerKey === providerKey) records.splice(i, 1);
      return before - records.length;
    }),
  };
}
