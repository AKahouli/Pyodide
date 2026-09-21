import type { ConnectorAction, ConnectorDynamicHeader } from '../schemas/connector.schema';

/** Store ports for the integrations connector tables (plan step 3.4–3.6). */
export const CONNECTOR_STORE = Symbol('CONNECTOR_STORE');
export const CONNECTOR_CATEGORY_STORE = Symbol('CONNECTOR_CATEGORY_STORE');
export const CONNECTOR_CREDENTIAL_STORE = Symbol('CONNECTOR_CREDENTIAL_STORE');
export const CONNECTOR_ADMIN_AUTH_STORE = Symbol('CONNECTOR_ADMIN_AUTH_STORE');
export const CONNECTOR_ADMIN_OAUTH_STATE_STORE = Symbol('CONNECTOR_ADMIN_OAUTH_STATE_STORE');

export interface ConnectorRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: string;
  categoryId: string | null;
  authType: string;
  authConfigSchema: Record<string, unknown>;
  authSourceType: string;
  connectedAppKey: string;
  runtimeAuthConfig: Record<string, unknown>;
  mcpTransportType: string;
  mcpServerUrl: string;
  mcpServerConfig: Record<string, unknown>;
  dynamicHeaders: ConnectorDynamicHeader[];
  actions: ConnectorAction[];
  /** From connector_skills, ordered by position. */
  skillIds: string[];
  isActive: boolean;
  isSystem: boolean;
  isHidden: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewConnectorRow {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: string;
  categoryId: string | null;
  authType: string;
  authConfigSchema: Record<string, unknown>;
  authSourceType: string;
  connectedAppKey: string;
  runtimeAuthConfig: Record<string, unknown>;
  mcpTransportType: string;
  mcpServerUrl: string;
  mcpServerConfig: Record<string, unknown>;
  dynamicHeaders: ConnectorDynamicHeader[];
  actions: ConnectorAction[];
  skillIds: string[];
  isActive: boolean;
  isSystem: boolean;
  isHidden: boolean;
  createdBy: string;
}

export interface ConnectorListQuery {
  search?: string;
  isActive?: boolean;
  page: number;
  limit: number;
}

export interface ConnectorStore {
  findBySlugAndOwner(slug: string, createdBy: string): Promise<ConnectorRow | null>;
  findById(id: string): Promise<ConnectorRow | null>;
  findActiveBySlug(slug: string): Promise<ConnectorRow | null>;
  findByIds(ids: string[]): Promise<ConnectorRow[]>;
  list(query: ConnectorListQuery): Promise<{ rows: ConnectorRow[]; total: number }>;
  findAllActive(): Promise<ConnectorRow[]>;
  /** Active + (not hidden OR the exception slug) — public selector listing. */
  findAllActiveVisible(exceptionSlug: string): Promise<ConnectorRow[]>;
  /** Category-id → name map in one query (gRPC binding hydration). */
  findNamesByIds(ids: string[]): Promise<Map<string, string>>;
  /** Connector ids among `ids` sitting in any of `categoryIds` (case handled by caller). */
  findIdsInCategories(ids: string[], categoryIds: string[]): Promise<string[]>;
  /** Slugs of the owner's connectors matching `slug` or `slug-<n>` (plan 3.4). */
  findImportSlugs(createdBy: string, baseSlug: string): Promise<string[]>;
  insert(row: NewConnectorRow): Promise<ConnectorRow>;
  /** Catalog import: all connectors (any flags), ids optional. */
  findAllExport(ids?: string[]): Promise<ConnectorRow[]>;
  update(id: string, patch: Partial<Omit<NewConnectorRow, 'slug' | 'createdBy'>> & { slug?: string }): Promise<ConnectorRow | null>;
  findBySlugExcludingOwner(slug: string, excludeId: string, createdBy: string): Promise<ConnectorRow | null>;
  delete(id: string): Promise<ConnectorRow | null>;
  /**
   * System MCP connector seed (plan 3.6): INSERT … ON CONFLICT (slug) WHERE
   * is_system DO UPDATE SET actions/updated_at — insert-only otherwise.
   */
  upsertSystemActionsBySlug(
    slug: string,
    seed: NewConnectorRow,
    actions: ConnectorAction[],
  ): Promise<ConnectorRow>;
}

export interface ConnectorCategoryRow {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorCategoryStore {
  ensureSystem(name: string, createdBy: string, description: string): Promise<void>;
  findByNameInsensitive(name: string): Promise<ConnectorCategoryRow | null>;
  findByOwnerName(createdBy: string, name: string): Promise<ConnectorCategoryRow | null>;
  findById(id: string): Promise<ConnectorCategoryRow | null>;
  findAll(): Promise<ConnectorCategoryRow[]>;
  insert(row: { name: string; description: string; isSystem?: boolean; createdBy: string }): Promise<ConnectorCategoryRow>;
  update(id: string, patch: { name?: string; description?: string }): Promise<ConnectorCategoryRow | null>;
  delete(id: string): Promise<boolean>;
  findNamesByIds(ids: string[]): Promise<Map<string, string>>;
  findIdsByNameInsensitive(name: string): Promise<string[]>;
}

export interface ConnectorCredentialRow {
  id: string;
  connectorId: string;
  displayName: string;
  authPayload: Record<string, unknown>;
  status: string;
  lastValidatedAt: Date | null;
  expiresAt: Date | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorCredentialStore {
  insert(row: { connectorId: string; displayName: string; authPayload: Record<string, unknown>; status: string; expiresAt: Date | null; userId: string }): Promise<ConnectorCredentialRow>;
  findByIdAndUser(id: string, userId: string): Promise<ConnectorCredentialRow | null>;
  list(filter: { userId?: string; connectorId?: string; status?: string }): Promise<ConnectorCredentialRow[]>;
  /** First active credential for (connectorId, userId), newest first. */
  findActiveFor(connectorId: string, userId: string): Promise<ConnectorCredentialRow | null>;
  update(id: string, patch: Partial<Pick<ConnectorCredentialRow, 'displayName' | 'authPayload' | 'status' | 'expiresAt' | 'lastValidatedAt'>>): Promise<ConnectorCredentialRow | null>;
  deleteByIdAndUser(id: string, userId: string): Promise<ConnectorCredentialRow | null>;
  /** Import upsert probe: same owner+connector+display name. */
  findByConnectorUserDisplayName(connectorId: string, userId: string, displayName: string): Promise<ConnectorCredentialRow | null>;
}

export interface ConnectorAdminAuthRow {
  id: string;
  userId: string;
  appKey: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  providerAccountId: string | null;
  providerEmail: string | null;
  connected: boolean;
  status: string;
  disconnectedAt: Date | null;
  lastUsedAt: Date | null;
  lastRefreshedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorAdminAuthStore {
  findByUserAndApp(userId: string, appKey: string): Promise<ConnectorAdminAuthRow | null>;
  findConnected(userId: string, appKey: string): Promise<ConnectorAdminAuthRow | null>;
  findByIdForUpdate(id: string): Promise<ConnectorAdminAuthRow | null>;
  upsertOnCallback(userId: string, appKey: string, payload: {
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiresAt: Date | null;
    scopes: string[];
  }): Promise<void>;
  /** Throttled hot-path write (plan 3.2). */
  touchLastUsedThrottled(id: string): Promise<void>;
  markDisconnected(id: string, payload: { status: string; disconnectedAt: Date }): Promise<void>;
  markStatus(id: string, status: string, errorMessage: string): Promise<void>;
  applyRefresh(id: string, payload: { accessToken: string; refreshToken?: string; tokenExpiresAt: Date | null }): Promise<void>;
  listConnected(): Promise<ConnectorAdminAuthRow[]>;
  /** Catalog import: insert when missing, else overwrite/keep (plan 3.7). */
  insertForImport(userId: string, appKey: string, payload: {
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    scopes: string[];
    providerAccountId?: string | null;
    providerEmail?: string | null;
    connected: boolean;
    status: string;
    disconnectedAt: Date | null;
    lastUsedAt: Date | null;
    lastRefreshedAt: Date | null;
    errorMessage: string | null;
  }): Promise<void>;
  updateById(id: string, patch: Partial<ConnectorAdminAuthRow>): Promise<void>;
}

export interface ConnectorAdminOauthStateStore {
  create(row: { state: string; appKey: string; userId: string; codeVerifier?: string | null; expiresAt: Date }): Promise<void>;
  /** Atomic consume: expired states read as invalid (plan 3.3). */
  consume(state: string): Promise<{ appKey: string; userId: string; codeVerifier: string | null } | null>;
  exists(state: string): Promise<boolean>;
}
