import type { ConnectionStatus } from '../connected-app.types';

/** Store ports for the integrations connected-app tables (plan step 3.1–3.3). */
export const CONNECTED_APP_DEFINITION_STORE = Symbol('CONNECTED_APP_DEFINITION_STORE');
export const USER_APP_CONNECTION_STORE = Symbol('USER_APP_CONNECTION_STORE');
export const CONNECTED_APP_OAUTH_STATE_STORE = Symbol('CONNECTED_APP_OAUTH_STATE_STORE');

export interface ConnectedAppDefinitionRow {
  id: string;
  appKey: string;
  displayName: string;
  description: string | null;
  iconKey: string | null;
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  clientId: string;
  clientSecret: string;
  tenantId: string | null;
  scopes: string[];
  pkceEnabled: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewConnectedAppDefinition = Omit<ConnectedAppDefinitionRow, 'id' | 'createdAt' | 'updatedAt'>;

export interface ConnectedAppDefinitionStore {
  findAllEnabled(): Promise<ConnectedAppDefinitionRow[]>;
  findAll(): Promise<ConnectedAppDefinitionRow[]>;
  findByKey(appKey: string): Promise<ConnectedAppDefinitionRow | null>;
  findById(id: string): Promise<ConnectedAppDefinitionRow | null>;
  existsByKey(appKey: string): Promise<boolean>;
  insert(row: NewConnectedAppDefinition): Promise<ConnectedAppDefinitionRow>;
  update(id: string, patch: Partial<NewConnectedAppDefinition>): Promise<ConnectedAppDefinitionRow | null>;
  /**
   * Delete the definition and every user connection on its app_key in one
   * transaction (plan 3.1). Returns null when the definition does not exist.
   */
  deleteWithConnections(id: string): Promise<{ appKey: string; deletedConnections: number } | null>;
}

export interface UserAppConnectionRow {
  id: string;
  userId: string;
  appKey: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  providerAccountId: string | null;
  providerEmail: string | null;
  status: ConnectionStatus;
  lastUsedAt: Date | null;
  lastRefreshedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertConnectionPayload {
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes: string[];
  providerAccountId?: string | null;
  providerEmail?: string | null;
  status: ConnectionStatus;
  errorMessage?: string | null;
}

export interface UserAppConnectionStore {
  findActive(userId: string, appKey: string): Promise<UserAppConnectionRow | null>;
  /** Row lock for the single-flight refresh (plan 3.2) — call inside a transaction. */
  findByIdForUpdate(id: string): Promise<UserAppConnectionRow | null>;
  findByUserAndApp(userId: string, appKey: string): Promise<UserAppConnectionRow | null>;
  countActive(userId: string, appKey: string): Promise<number>;
  listByUser(userId: string): Promise<UserAppConnectionRow[]>;
  listActiveByUser(userId: string): Promise<UserAppConnectionRow[]>;
  countByAppKey(appKey: string): Promise<number>;
  upsertOnCallback(userId: string, appKey: string, payload: UpsertConnectionPayload): Promise<UserAppConnectionRow>;
  /** Catalog import: insert when missing, else overwrite/keep (plan 3.7). */
  insertForImport(userId: string, appKey: string, payload: UpsertConnectionPayload): Promise<UserAppConnectionRow>;
  updateById(id: string, patch: Partial<UpsertConnectionPayload> & { lastRefreshedAt?: Date | null; lastUsedAt?: Date | null }): Promise<void>;
  /** Throttled hot-path write (plan 3.2): at most one update per minute. */
  touchLastUsedThrottled(id: string): Promise<void>;
  /** Sets status/errorMessage only while the row is still active. */
  markInactive(id: string, status: ConnectionStatus, errorMessage: string): Promise<void>;
  /** Persist refreshed tokens only while active (single-flight tail). */
  applyRefresh(id: string, payload: { accessToken: string; refreshToken?: string; tokenExpiresAt: Date | null }): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export interface ConnectedAppOauthStateRow {
  id: string;
  state: string;
  appKey: string;
  userId: string;
  codeVerifier: string | null;
  expiresAt: Date;
}

export interface ConnectedAppOauthStateStore {
  create(row: { state: string; appKey: string; userId: string; codeVerifier?: string | null; expiresAt: Date }): Promise<void>;
  /**
   * Atomic consumption (plan 3.3): DELETE … WHERE state=$1 AND expires_at >
   * now() RETURNING * — an expired state reads as invalid.
   */
  consume(state: string): Promise<ConnectedAppOauthStateRow | null>;
  /** Unexpired-state probe for the unified callback router (plan 3.3). */
  exists(state: string): Promise<boolean>;
}
