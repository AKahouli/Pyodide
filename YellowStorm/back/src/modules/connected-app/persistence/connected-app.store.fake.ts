import { ConnectionStatus } from '../connected-app.types';
import type {
  ConnectedAppDefinitionRow,
  ConnectedAppDefinitionStore,
  ConnectedAppOauthStateRow,
  ConnectedAppOauthStateStore,
  NewConnectedAppDefinition,
  UpsertConnectionPayload,
  UserAppConnectionRow,
  UserAppConnectionStore,
} from './connected-app.store';

/** Shared in-memory fakes for the connected-app store ports (spec use). */

export class InMemoryDefinitionStore implements ConnectedAppDefinitionStore {
  readonly rows: ConnectedAppDefinitionRow[] = [];

  private next(over: Partial<ConnectedAppDefinitionRow>): ConnectedAppDefinitionRow {
    return {
      id: over.id ?? Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      appKey: 'app',
      displayName: 'App',
      description: null,
      iconKey: null,
      authorizationUrl: 'https://auth',
      tokenUrl: 'https://token',
      revokeUrl: null,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tenantId: null,
      scopes: [],
      pkceEnabled: false,
      enabled: true,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
  }

  seed(over: Partial<ConnectedAppDefinitionRow>): ConnectedAppDefinitionRow {
    const row = this.next(over);
    this.rows.push(row);
    return row;
  }

  async findAllEnabled(): Promise<ConnectedAppDefinitionRow[]> {
    return this.rows.filter((r) => r.enabled);
  }

  async findAll(): Promise<ConnectedAppDefinitionRow[]> {
    return this.rows;
  }

  async findByKey(appKey: string): Promise<ConnectedAppDefinitionRow | null> {
    return this.rows.find((r) => r.appKey === appKey) ?? null;
  }

  async findById(id: string): Promise<ConnectedAppDefinitionRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async existsByKey(appKey: string): Promise<boolean> {
    return this.rows.some((r) => r.appKey === appKey);
  }

  async insert(row: NewConnectedAppDefinition): Promise<ConnectedAppDefinitionRow> {
    return this.seed(row);
  }

  async update(id: string, patch: Partial<NewConnectedAppDefinition>): Promise<ConnectedAppDefinitionRow | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }

  async deleteWithConnections(id: string): Promise<{ appKey: string; deletedConnections: number } | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    this.rows.splice(this.rows.indexOf(row), 1);
    return { appKey: row.appKey, deletedConnections: 0 };
  }
}

export class InMemoryConnectionStore implements UserAppConnectionStore {
  readonly rows: UserAppConnectionRow[] = [];

  seed(over: Partial<UserAppConnectionRow>): UserAppConnectionRow {
    const row = {
      id: Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      userId: 'u1',
      appKey: 'app',
      accessToken: 'enc-access',
      refreshToken: 'enc-refresh',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      scopes: [],
      providerAccountId: null,
      providerEmail: null,
      status: ConnectionStatus.ACTIVE,
      lastUsedAt: null,
      lastRefreshedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  async findActive(userId: string, appKey: string): Promise<UserAppConnectionRow | null> {
    return this.rows.find((r) => r.userId === userId && r.appKey === appKey && r.status === ConnectionStatus.ACTIVE) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<UserAppConnectionRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByUserAndApp(userId: string, appKey: string): Promise<UserAppConnectionRow | null> {
    return this.rows.find((r) => r.userId === userId && r.appKey === appKey) ?? null;
  }

  async countActive(userId: string, appKey: string): Promise<number> {
    return this.rows.filter((r) => r.userId === userId && r.appKey === appKey && r.status === ConnectionStatus.ACTIVE).length;
  }

  async listByUser(userId: string): Promise<UserAppConnectionRow[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async listActiveByUser(userId: string): Promise<UserAppConnectionRow[]> {
    return this.rows.filter((r) => r.userId === userId && r.status === ConnectionStatus.ACTIVE);
  }

  async countByAppKey(appKey: string): Promise<number> {
    return this.rows.filter((r) => r.appKey === appKey).length;
  }

  async upsertOnCallback(userId: string, appKey: string, payload: UpsertConnectionPayload): Promise<UserAppConnectionRow> {
    let row = await this.findByUserAndApp(userId, appKey);
    if (!row) {
      row = this.seed({ userId, appKey, ...payload } as Partial<UserAppConnectionRow>);
    } else {
      Object.assign(row, payload, { lastRefreshedAt: new Date() });
    }
    return row;
  }

  async touchLastUsedThrottled(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.lastUsedAt = new Date();
  }

  async markInactive(id: string, status: UserAppConnectionRow['status'], errorMessage: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id && r.status === ConnectionStatus.ACTIVE);
    if (row) {
      row.status = status;
      row.errorMessage = errorMessage;
    }
  }

  async applyRefresh(id: string, payload: { accessToken: string; refreshToken?: string; tokenExpiresAt: Date | null }): Promise<void> {
    const row = this.rows.find((r) => r.id === id && r.status === ConnectionStatus.ACTIVE);
    if (row) {
      row.accessToken = payload.accessToken;
      if (payload.refreshToken) row.refreshToken = payload.refreshToken;
      row.tokenExpiresAt = payload.tokenExpiresAt;
      row.lastRefreshedAt = new Date();
      row.lastUsedAt = new Date();
      row.errorMessage = null;
    }
  }

  async deleteById(id: string): Promise<void> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx >= 0) this.rows.splice(idx, 1);
  }

  async insertForImport(userId: string, appKey: string, payload: UpsertConnectionPayload): Promise<UserAppConnectionRow> {
    return this.upsertOnCallback(userId, appKey, payload);
  }

  async updateById(id: string, patch: Partial<UpsertConnectionPayload> & { lastRefreshedAt?: Date | null; lastUsedAt?: Date | null }): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
  }
}

export class InMemoryOauthStateStore implements ConnectedAppOauthStateStore {
  readonly consumed: string[] = [];
  private rows: Array<ConnectedAppOauthStateRow & { expired?: boolean }> = [];

  seed(over: Partial<ConnectedAppOauthStateRow> & { expired?: boolean }): ConnectedAppOauthStateRow {
    const row = {
      id: Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      state: 'state-' + Math.random().toString(16).slice(2, 8),
      appKey: 'app',
      userId: 'u1',
      codeVerifier: null,
      expiresAt: new Date(Date.now() + 600_000),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  async create(row: { state: string; appKey: string; userId: string; codeVerifier?: string | null; expiresAt: Date }): Promise<void> {
    this.seed(row);
  }

  async consume(state: string): Promise<ConnectedAppOauthStateRow | null> {
    const idx = this.rows.findIndex((r) => r.state === state && !r.expired);
    if (idx < 0) return null;
    const [row] = this.rows.splice(idx, 1);
    this.consumed.push(state);
    return row;
  }

  async exists(state: string): Promise<boolean> {
    return this.rows.some((r) => r.state === state && !r.expired);
  }
}
