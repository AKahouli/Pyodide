import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { escapeLike } from '@common/postgres/like';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import type { ConnectorAction } from '../connector.types';
import {
  CONNECTOR_ADMIN_AUTH_STORE,
  CONNECTOR_ADMIN_OAUTH_STATE_STORE,
  CONNECTOR_CATEGORY_STORE,
  CONNECTOR_CREDENTIAL_STORE,
  CONNECTOR_STORE,
  type ConnectorAdminAuthRow,
  type ConnectorAdminAuthStore,
  type ConnectorCategoryRow,
  type ConnectorCategoryStore,
  type ConnectorCredentialRow,
  type ConnectorCredentialStore,
  type ConnectorAdminOauthStateStore,
  type ConnectorListQuery,
  type ConnectorRow,
  type ConnectorStore,
  type NewConnectorRow,
} from './connector.store';

type ConnRow = typeof schema.integrationsConnectors.$inferSelect;
type CatRow = typeof schema.integrationsConnectorCategories.$inferSelect;
type CredRow = typeof schema.integrationsConnectorCredentials.$inferSelect;
type AuthRow = typeof schema.integrationsAdminConnectorAuthTokens.$inferSelect;

async function hydrateSkills(
  q: PgQueryable<typeof schema>,
  connectorIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (connectorIds.length === 0) return map;
  const rows = await q
    .select({ connectorId: schema.integrationsConnectorSkills.connectorId, skillId: schema.integrationsConnectorSkills.skillId })
    .from(schema.integrationsConnectorSkills)
    .where(inArray(schema.integrationsConnectorSkills.connectorId, connectorIds))
    .orderBy(asc(schema.integrationsConnectorSkills.position));
  for (const row of rows) {
    const list = map.get(row.connectorId) ?? [];
    list.push(row.skillId);
    map.set(row.connectorId, list);
  }
  return map;
}

function connectorToRow(r: ConnRow, skillIds: string[]): ConnectorRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    icon: r.icon,
    color: r.color,
    iconColor: r.iconColor,
    categoryId: r.categoryId ?? null,
    authType: r.authType,
    authConfigSchema: r.authConfigSchema ?? {},
    authSourceType: r.authSourceType,
    connectedAppKey: r.connectedAppKey,
    runtimeAuthConfig: r.runtimeAuthConfig ?? {},
    mcpTransportType: r.mcpTransportType,
    mcpServerUrl: r.mcpServerUrl,
    mcpServerConfig: r.mcpServerConfig ?? {},
    dynamicHeaders: (r.dynamicHeaders ?? []) as unknown as ConnectorRow["dynamicHeaders"],
    actions: (r.actions ?? []) as unknown as ConnectorRow["actions"],
    skillIds,
    isActive: r.isActive,
    isSystem: r.isSystem,
    isHidden: r.isHidden,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PgConnectorStore implements ConnectorStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private async hydrate(rows: ConnRow[]): Promise<ConnectorRow[]> {
    const skills = await hydrateSkills(this.q, rows.map((r) => r.id));
    return rows.map((r) => connectorToRow(r, skills.get(r.id) ?? []));
  }

  private async hydrateOne(row: ConnRow): Promise<ConnectorRow> {
    const skills = await hydrateSkills(this.q, [row.id]);
    return connectorToRow(row, skills.get(row.id) ?? []);
  }

  /** Replace the connector_skills junction (position = array order). */
  private async replaceSkills(tx: PgQueryable<typeof schema>, connectorId: string, skillIds: string[]): Promise<void> {
    await tx.delete(schema.integrationsConnectorSkills).where(eq(schema.integrationsConnectorSkills.connectorId, connectorId));
    if (skillIds.length > 0) {
      await tx.insert(schema.integrationsConnectorSkills).values(
        skillIds.map((skillId, position) => ({ connectorId, skillId, position })),
      );
    }
  }

  async findBySlugAndOwner(slug: string, createdBy: string): Promise<ConnectorRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(and(eq(schema.integrationsConnectors.slug, slug), eq(schema.integrationsConnectors.createdBy, createdBy)))
      .limit(1);
    return row ? this.hydrateOne(row) : null;
  }

  async findById(id: string): Promise<ConnectorRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(eq(schema.integrationsConnectors.id, id))
      .limit(1);
    return row ? this.hydrateOne(row) : null;
  }

  async findActiveBySlug(slug: string): Promise<ConnectorRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(and(eq(schema.integrationsConnectors.slug, slug), eq(schema.integrationsConnectors.isActive, true)))
      .limit(1);
    return row ? this.hydrateOne(row) : null;
  }

  async findByIds(ids: string[]): Promise<ConnectorRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(and(inArray(schema.integrationsConnectors.id, ids), eq(schema.integrationsConnectors.isActive, true)))
      .orderBy(asc(schema.integrationsConnectors.name));
    return this.hydrate(rows);
  }

  async list(query: ConnectorListQuery): Promise<{ rows: ConnectorRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.search) {
      const search = `%${escapeLike(query.search)}%`;
      conditions.push(or(ilike(schema.integrationsConnectors.slug, search), ilike(schema.integrationsConnectors.name, search))!);
    }
    if (query.isActive !== undefined) conditions.push(eq(schema.integrationsConnectors.isActive, query.isActive));
    const filter = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [tally]] = await Promise.all([
      this.q
        .select()
        .from(schema.integrationsConnectors)
        .where(filter)
        .orderBy(desc(schema.integrationsConnectors.createdAt))
        .offset((query.page - 1) * query.limit)
        .limit(query.limit),
      this.q.select({ n: sql<number>`count(*)::int` }).from(schema.integrationsConnectors).where(filter),
    ]);

    return { rows: await this.hydrate(rows), total: tally?.n ?? 0 };
  }

  async findAllActive(): Promise<ConnectorRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(eq(schema.integrationsConnectors.isActive, true))
      .orderBy(asc(schema.integrationsConnectors.name));
    return this.hydrate(rows);
  }

  async findAllActiveVisible(exceptionSlug: string): Promise<ConnectorRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(and(
        eq(schema.integrationsConnectors.isActive, true),
        sql`(${schema.integrationsConnectors.isHidden} = false OR ${schema.integrationsConnectors.slug} = ${exceptionSlug})`,
      ))
      .orderBy(asc(schema.integrationsConnectors.name));
    return this.hydrate(rows);
  }

  async findNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.q
      .select({ id: schema.integrationsConnectorCategories.id, name: schema.integrationsConnectorCategories.name })
      .from(schema.integrationsConnectorCategories)
      .where(inArray(schema.integrationsConnectorCategories.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async findIdsInCategories(ids: string[], categoryIds: string[]): Promise<string[]> {
    if (ids.length === 0 || categoryIds.length === 0) return [];
    const rows = await this.q
      .select({ id: schema.integrationsConnectors.id })
      .from(schema.integrationsConnectors)
      .where(and(
        inArray(schema.integrationsConnectors.id, ids),
        inArray(schema.integrationsConnectors.categoryId, categoryIds),
        eq(schema.integrationsConnectors.isActive, true),
      ));
    return rows.map((r) => r.id);
  }

  async findImportSlugs(createdBy: string, baseSlug: string): Promise<string[]> {
    const rows = await this.q
      .select({ slug: schema.integrationsConnectors.slug })
      .from(schema.integrationsConnectors)
      .where(and(
        eq(schema.integrationsConnectors.createdBy, createdBy),
        sql`(${schema.integrationsConnectors.slug} = ${baseSlug} OR ${schema.integrationsConnectors.slug} ~ ${'^' + baseSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-[0-9]+$'})`,
      ));
    return rows.map((r) => r.slug);
  }

  async insert(row: NewConnectorRow): Promise<ConnectorRow> {
    return withTransaction(this.db, async (tx) => {
      const [inserted] = await tx
        .insert(schema.integrationsConnectors)
        .values({ id: newObjectId(), ...row, skillIds: undefined as never } as unknown as typeof schema.integrationsConnectors.$inferInsert)
        .returning();
      await this.replaceSkills(tx, inserted.id, row.skillIds);
      const skills = await hydrateSkills(tx, [inserted.id]);
      return connectorToRow(inserted, skills.get(inserted.id) ?? []);
    });
  }

  async update(id: string, patch: Partial<Omit<NewConnectorRow, 'slug' | 'createdBy'>> & { slug?: string }): Promise<ConnectorRow | null> {
    return withTransaction(this.db, async (tx) => {
      const { skillIds, ...columns } = patch;
      const [row] = await tx
        .update(schema.integrationsConnectors)
        .set({ ...columns, updatedAt: new Date() } as unknown as Partial<typeof schema.integrationsConnectors.$inferInsert>)
        .where(eq(schema.integrationsConnectors.id, id))
        .returning();
      if (!row) return null;
      if (skillIds) await this.replaceSkills(tx, id, skillIds);
      const skills = await hydrateSkills(tx, [id]);
      return connectorToRow(row, skills.get(id) ?? []);
    });
  }

  async findBySlugExcludingOwner(slug: string, excludeId: string, createdBy: string): Promise<ConnectorRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(and(
        sql`${schema.integrationsConnectors.id} <> ${excludeId}`,
        eq(schema.integrationsConnectors.slug, slug),
        eq(schema.integrationsConnectors.createdBy, createdBy),
      ))
      .limit(1);
    return row ? this.hydrateOne(row) : null;
  }

  async delete(id: string): Promise<ConnectorRow | null> {
    // Credentials and connector_skills cascade via validated FKs (plan 3.5).
    const [row] = await this.q
      .delete(schema.integrationsConnectors)
      .where(eq(schema.integrationsConnectors.id, id))
      .returning();
    return row ? connectorToRow(row, []) : null;
  }

  async upsertSystemActionsBySlug(
    slug: string,
    seed: NewConnectorRow,
    actions: ConnectorAction[],
  ): Promise<ConnectorRow> {
    const { skillIds: _skillIds, ...c } = seed;
    return withTransaction(this.db, async (tx) => {
      // Partial unique index (slug WHERE is_system): raw SQL for the conflict target.
      await tx.execute(sql`
        INSERT INTO integrations.connectors
          (id, slug, name, description, icon, color, icon_color, category_id, auth_type,
           auth_config_schema, auth_source_type, connected_app_key, runtime_auth_config,
           mcp_transport_type, mcp_server_url, mcp_server_config, dynamic_headers, actions,
           is_active, is_system, is_hidden, created_by)
        VALUES (${newObjectId()}, ${slug}, ${c.name}, ${c.description}, ${c.icon}, ${c.color},
                ${c.iconColor}, ${c.categoryId}, ${c.authType}, ${JSON.stringify(c.authConfigSchema)}::jsonb,
                ${c.authSourceType}, ${c.connectedAppKey}, ${JSON.stringify(c.runtimeAuthConfig)}::jsonb,
                ${c.mcpTransportType}, ${c.mcpServerUrl}, ${JSON.stringify(c.mcpServerConfig)}::jsonb,
                ${JSON.stringify(c.dynamicHeaders)}::jsonb, ${JSON.stringify(actions)}::jsonb,
                ${c.isActive}, ${c.isSystem}, ${c.isHidden}, ${c.createdBy})
        ON CONFLICT (slug) WHERE is_system
        DO UPDATE SET actions = EXCLUDED.actions, updated_at = now()
      `);
      const [row] = await tx.select().from(schema.integrationsConnectors).where(eq(schema.integrationsConnectors.slug, slug)).limit(1);
      const skills = await hydrateSkills(tx, [row.id]);
      return connectorToRow(row, skills.get(row.id) ?? []);
    });
  }

  async findAllExport(ids?: string[]): Promise<ConnectorRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectors)
      .where(ids && ids.length > 0 ? inArray(schema.integrationsConnectors.id, ids) : undefined)
      .orderBy(asc(schema.integrationsConnectors.name));
    return this.hydrate(rows);
  }
}

export class PgConnectorCategoryStore implements ConnectorCategoryStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private toRow = (r: CatRow): ConnectorCategoryRow => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  async ensureSystem(name: string, createdBy: string, description: string): Promise<void> {
    await this.q
      .insert(schema.integrationsConnectorCategories)
      .values({ id: newObjectId(), name, createdBy, description, isSystem: true })
      .onConflictDoUpdate({
        target: [schema.integrationsConnectorCategories.name, schema.integrationsConnectorCategories.createdBy],
        set: { isSystem: true, updatedAt: new Date() },
      });
  }

  async findByNameInsensitive(name: string): Promise<ConnectorCategoryRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectorCategories)
      .where(sql`lower(${schema.integrationsConnectorCategories.name}) = ${name.toLowerCase()}`)
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async findByOwnerName(createdBy: string, name: string): Promise<ConnectorCategoryRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectorCategories)
      .where(and(
        eq(schema.integrationsConnectorCategories.createdBy, createdBy),
        eq(schema.integrationsConnectorCategories.name, name),
      ))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async findById(id: string): Promise<ConnectorCategoryRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectorCategories)
      .where(eq(schema.integrationsConnectorCategories.id, id))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async findAll(): Promise<ConnectorCategoryRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectorCategories)
      .orderBy(asc(schema.integrationsConnectorCategories.name));
    return rows.map(this.toRow);
  }

  async insert(row: { name: string; description: string; isSystem?: boolean; createdBy: string }): Promise<ConnectorCategoryRow> {
    const [inserted] = await this.q
      .insert(schema.integrationsConnectorCategories)
      .values({ id: newObjectId(), ...row, isSystem: row.isSystem ?? false })
      .returning();
    return this.toRow(inserted);
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<ConnectorCategoryRow | null> {
    const [row] = await this.q
      .update(schema.integrationsConnectorCategories)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.integrationsConnectorCategories.id, id))
      .returning();
    return row ? this.toRow(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.q
      .delete(schema.integrationsConnectorCategories)
      .where(eq(schema.integrationsConnectorCategories.id, id))
      .returning({ id: schema.integrationsConnectorCategories.id });
    return rows.length > 0;
  }

  async findNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.q
      .select({ id: schema.integrationsConnectorCategories.id, name: schema.integrationsConnectorCategories.name })
      .from(schema.integrationsConnectorCategories)
      .where(inArray(schema.integrationsConnectorCategories.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async findIdsByNameInsensitive(name: string): Promise<string[]> {
    const rows = await this.q
      .select({ id: schema.integrationsConnectorCategories.id })
      .from(schema.integrationsConnectorCategories)
      .where(sql`lower(${schema.integrationsConnectorCategories.name}) = ${name.toLowerCase()}`);
    return rows.map((r) => r.id);
  }
}

export class PgConnectorCredentialStore implements ConnectorCredentialStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private toRow = (r: CredRow): ConnectorCredentialRow => ({
    id: r.id,
    connectorId: r.connectorId,
    displayName: r.displayName,
    authPayload: r.authPayload ?? {},
    status: r.status,
    lastValidatedAt: r.lastValidatedAt ?? null,
    expiresAt: r.expiresAt ?? null,
    userId: r.userId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  async insert(row: { connectorId: string; displayName: string; authPayload: Record<string, unknown>; status: string; expiresAt: Date | null; userId: string }): Promise<ConnectorCredentialRow> {
    const [inserted] = await this.q
      .insert(schema.integrationsConnectorCredentials)
      .values({ id: newObjectId(), ...row })
      .returning();
    return this.toRow(inserted);
  }

  async findByIdAndUser(id: string, userId: string): Promise<ConnectorCredentialRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectorCredentials)
      .where(and(
        eq(schema.integrationsConnectorCredentials.id, id),
        eq(schema.integrationsConnectorCredentials.userId, userId),
      ))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async list(filter: { userId?: string; connectorId?: string; status?: string }): Promise<ConnectorCredentialRow[]> {
    const conditions: SQL[] = [];
    if (filter.userId) conditions.push(eq(schema.integrationsConnectorCredentials.userId, filter.userId));
    if (filter.connectorId) conditions.push(eq(schema.integrationsConnectorCredentials.connectorId, filter.connectorId));
    if (filter.status) conditions.push(eq(schema.integrationsConnectorCredentials.status, filter.status));
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectorCredentials)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.integrationsConnectorCredentials.createdAt));
    return rows.map(this.toRow);
  }

  async findActiveFor(connectorId: string, userId: string): Promise<ConnectorCredentialRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectorCredentials)
      .where(and(
        eq(schema.integrationsConnectorCredentials.connectorId, connectorId),
        eq(schema.integrationsConnectorCredentials.userId, userId),
        eq(schema.integrationsConnectorCredentials.status, 'active'),
      ))
      .orderBy(desc(schema.integrationsConnectorCredentials.updatedAt))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async update(id: string, patch: Partial<Pick<ConnectorCredentialRow, 'displayName' | 'authPayload' | 'status' | 'expiresAt' | 'lastValidatedAt'>>): Promise<ConnectorCredentialRow | null> {
    const [row] = await this.q
      .update(schema.integrationsConnectorCredentials)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.integrationsConnectorCredentials.id, id))
      .returning();
    return row ? this.toRow(row) : null;
  }

  async deleteByIdAndUser(id: string, userId: string): Promise<ConnectorCredentialRow | null> {
    const [row] = await this.q
      .delete(schema.integrationsConnectorCredentials)
      .where(and(
        eq(schema.integrationsConnectorCredentials.id, id),
        eq(schema.integrationsConnectorCredentials.userId, userId),
      ))
      .returning();
    return row ? this.toRow(row) : null;
  }

  async findByConnectorUserDisplayName(connectorId: string, userId: string, displayName: string): Promise<ConnectorCredentialRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectorCredentials)
      .where(and(
        eq(schema.integrationsConnectorCredentials.connectorId, connectorId),
        eq(schema.integrationsConnectorCredentials.userId, userId),
        eq(schema.integrationsConnectorCredentials.displayName, displayName),
      ))
      .limit(1);
    return row ? this.toRow(row) : null;
  }
}

export class PgConnectorAdminAuthStore implements ConnectorAdminAuthStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private toRow = (r: AuthRow): ConnectorAdminAuthRow => ({
    id: r.id,
    userId: r.userId,
    appKey: r.appKey,
    accessToken: r.accessToken ?? null,
    refreshToken: r.refreshToken ?? null,
    tokenExpiresAt: r.tokenExpiresAt ?? null,
    scopes: r.scopes ?? [],
    providerAccountId: r.providerAccountId ?? null,
    providerEmail: r.providerEmail ?? null,
    connected: r.connected,
    status: r.status,
    disconnectedAt: r.disconnectedAt ?? null,
    lastUsedAt: r.lastUsedAt ?? null,
    lastRefreshedAt: r.lastRefreshedAt ?? null,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  async findByUserAndApp(userId: string, appKey: string): Promise<ConnectorAdminAuthRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsAdminConnectorAuthTokens)
      .where(and(
        eq(schema.integrationsAdminConnectorAuthTokens.userId, userId),
        eq(schema.integrationsAdminConnectorAuthTokens.appKey, appKey),
      ))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async findConnected(userId: string, appKey: string): Promise<ConnectorAdminAuthRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsAdminConnectorAuthTokens)
      .where(and(
        eq(schema.integrationsAdminConnectorAuthTokens.userId, userId),
        eq(schema.integrationsAdminConnectorAuthTokens.appKey, appKey),
        eq(schema.integrationsAdminConnectorAuthTokens.connected, true),
      ))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<ConnectorAdminAuthRow | null> {
    const rows = await this.q
      .select()
      .from(schema.integrationsAdminConnectorAuthTokens)
      .where(eq(schema.integrationsAdminConnectorAuthTokens.id, id))
      .for('update')
      .limit(1);
    return rows[0] ? this.toRow(rows[0]) : null;
  }

  async upsertOnCallback(userId: string, appKey: string, payload: {
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiresAt: Date | null;
    scopes: string[];
  }): Promise<void> {
    await this.q
      .insert(schema.integrationsAdminConnectorAuthTokens)
      .values({
        id: newObjectId(),
        userId,
        appKey,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? null,
        tokenExpiresAt: payload.tokenExpiresAt,
        scopes: payload.scopes,
        connected: true,
        status: 'active',
        lastRefreshedAt: new Date(),
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.integrationsAdminConnectorAuthTokens.userId, schema.integrationsAdminConnectorAuthTokens.appKey],
        set: {
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken ?? null,
          tokenExpiresAt: payload.tokenExpiresAt,
          scopes: payload.scopes,
          connected: true,
          status: 'active',
          disconnectedAt: null,
          errorMessage: null,
          lastRefreshedAt: new Date(),
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  async touchLastUsedThrottled(id: string): Promise<void> {
    await this.q
      .update(schema.integrationsAdminConnectorAuthTokens)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.integrationsAdminConnectorAuthTokens.id, id),
        sql`(${schema.integrationsAdminConnectorAuthTokens.lastUsedAt} IS NULL OR ${schema.integrationsAdminConnectorAuthTokens.lastUsedAt} < now() - interval '60 seconds')`,
      ));
  }

  async markDisconnected(id: string, payload: { status: string; disconnectedAt: Date }): Promise<void> {
    await this.q
      .update(schema.integrationsAdminConnectorAuthTokens)
      .set({
        connected: false,
        status: payload.status,
        disconnectedAt: payload.disconnectedAt,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationsAdminConnectorAuthTokens.id, id));
  }

  async markStatus(id: string, status: string, errorMessage: string): Promise<void> {
    await this.q
      .update(schema.integrationsAdminConnectorAuthTokens)
      .set({ status, errorMessage, updatedAt: new Date() })
      .where(and(
        eq(schema.integrationsAdminConnectorAuthTokens.id, id),
        eq(schema.integrationsAdminConnectorAuthTokens.connected, true),
      ));
  }

  async applyRefresh(id: string, payload: { accessToken: string; refreshToken?: string; tokenExpiresAt: Date | null }): Promise<void> {
    await this.q
      .update(schema.integrationsAdminConnectorAuthTokens)
      .set({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        tokenExpiresAt: payload.tokenExpiresAt,
        lastRefreshedAt: new Date(),
        lastUsedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.integrationsAdminConnectorAuthTokens.id, id),
        eq(schema.integrationsAdminConnectorAuthTokens.connected, true),
      ));
  }

  async insertForImport(userId: string, appKey: string, payload: {
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
  }): Promise<void> {
    await this.q
      .insert(schema.integrationsAdminConnectorAuthTokens)
      .values({ id: newObjectId(), userId, appKey, ...payload })
      .onConflictDoNothing({
        target: [schema.integrationsAdminConnectorAuthTokens.userId, schema.integrationsAdminConnectorAuthTokens.appKey],
      });
  }

  async updateById(id: string, patch: Partial<ConnectorAdminAuthRow>): Promise<void> {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = patch;
    await this.q
      .update(schema.integrationsAdminConnectorAuthTokens)
      .set({ ...rest, updatedAt: new Date() } as unknown as Partial<typeof schema.integrationsAdminConnectorAuthTokens.$inferInsert>)
      .where(eq(schema.integrationsAdminConnectorAuthTokens.id, id));
  }

  async listConnected(): Promise<ConnectorAdminAuthRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsAdminConnectorAuthTokens)
      .where(eq(schema.integrationsAdminConnectorAuthTokens.connected, true));
    return rows.map(this.toRow);
  }
}

export class PgConnectorAdminOauthStateStore implements ConnectorAdminOauthStateStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(row: { state: string; appKey: string; userId: string; codeVerifier?: string | null; expiresAt: Date }): Promise<void> {
    await this.q
      .insert(schema.integrationsAdminConnectorOauthStates)
      .values({ id: newObjectId(), ...row, codeVerifier: row.codeVerifier ?? null });
  }

  async consume(state: string): Promise<{ appKey: string; userId: string; codeVerifier: string | null } | null> {
    const [row] = await this.q
      .delete(schema.integrationsAdminConnectorOauthStates)
      .where(and(
        eq(schema.integrationsAdminConnectorOauthStates.state, state),
        gt(schema.integrationsAdminConnectorOauthStates.expiresAt, new Date()),
      ))
      .returning();
    if (!row) return null;
    return { appKey: row.appKey, userId: row.userId, codeVerifier: row.codeVerifier ?? null };
  }

  async exists(state: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: schema.integrationsAdminConnectorOauthStates.id })
      .from(schema.integrationsAdminConnectorOauthStates)
      .where(and(
        eq(schema.integrationsAdminConnectorOauthStates.state, state),
        gt(schema.integrationsAdminConnectorOauthStates.expiresAt, new Date()),
      ))
      .limit(1);
    return rows.length > 0;
  }
}
