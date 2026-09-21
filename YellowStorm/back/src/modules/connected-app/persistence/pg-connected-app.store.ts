import { Inject } from '@nestjs/common';
import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  CONNECTED_APP_DEFINITION_STORE,
  CONNECTED_APP_OAUTH_STATE_STORE,
  USER_APP_CONNECTION_STORE,
  type ConnectedAppDefinitionRow,
  type ConnectedAppDefinitionStore,
  type ConnectedAppOauthStateRow,
  type ConnectedAppOauthStateStore,
  type NewConnectedAppDefinition,
  type UpsertConnectionPayload,
  type UserAppConnectionRow,
  type UserAppConnectionStore,
} from './connected-app.store';

type DefRow = typeof schema.integrationsConnectedAppDefinitions.$inferSelect;
type ConnRow = typeof schema.integrationsUserAppConnections.$inferSelect;
type StateRow = typeof schema.integrationsConnectedAppOauthStates.$inferSelect;

function defToRow(r: DefRow): ConnectedAppDefinitionRow {
  return {
    id: r.id,
    appKey: r.appKey,
    displayName: r.displayName,
    description: r.description ?? null,
    iconKey: r.iconKey ?? null,
    authorizationUrl: r.authorizationUrl,
    tokenUrl: r.tokenUrl,
    revokeUrl: r.revokeUrl ?? null,
    clientId: r.clientId,
    clientSecret: r.clientSecret,
    tenantId: r.tenantId ?? null,
    scopes: r.scopes ?? [],
    pkceEnabled: r.pkceEnabled,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function connToRow(r: ConnRow): UserAppConnectionRow {
  return {
    id: r.id,
    userId: r.userId,
    appKey: r.appKey,
    accessToken: r.accessToken,
    refreshToken: r.refreshToken ?? null,
    tokenExpiresAt: r.tokenExpiresAt ?? null,
    scopes: r.scopes ?? [],
    providerAccountId: r.providerAccountId ?? null,
    providerEmail: r.providerEmail ?? null,
    status: r.status as UserAppConnectionRow['status'],
    lastUsedAt: r.lastUsedAt ?? null,
    lastRefreshedAt: r.lastRefreshedAt ?? null,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** PostgreSQL integrations implementation of the connected-app stores (plan 3.1–3.3). */
export class PgConnectedAppDefinitionStore implements ConnectedAppDefinitionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findAllEnabled(): Promise<ConnectedAppDefinitionRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectedAppDefinitions)
      .where(eq(schema.integrationsConnectedAppDefinitions.enabled, true))
      .orderBy(asc(schema.integrationsConnectedAppDefinitions.sortOrder), asc(schema.integrationsConnectedAppDefinitions.displayName));
    return rows.map(defToRow);
  }

  async findAll(): Promise<ConnectedAppDefinitionRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsConnectedAppDefinitions)
      .orderBy(asc(schema.integrationsConnectedAppDefinitions.sortOrder), asc(schema.integrationsConnectedAppDefinitions.displayName));
    return rows.map(defToRow);
  }

  async findByKey(appKey: string): Promise<ConnectedAppDefinitionRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectedAppDefinitions)
      .where(eq(schema.integrationsConnectedAppDefinitions.appKey, appKey.toLowerCase()))
      .limit(1);
    return row ? defToRow(row) : null;
  }

  async findById(id: string): Promise<ConnectedAppDefinitionRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsConnectedAppDefinitions)
      .where(eq(schema.integrationsConnectedAppDefinitions.id, id))
      .limit(1);
    return row ? defToRow(row) : null;
  }

  async existsByKey(appKey: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: schema.integrationsConnectedAppDefinitions.id })
      .from(schema.integrationsConnectedAppDefinitions)
      .where(eq(schema.integrationsConnectedAppDefinitions.appKey, appKey.toLowerCase()))
      .limit(1);
    return rows.length > 0;
  }

  async insert(row: NewConnectedAppDefinition): Promise<ConnectedAppDefinitionRow> {
    const [inserted] = await this.q
      .insert(schema.integrationsConnectedAppDefinitions)
      .values({ id: newObjectId(), ...row })
      .returning();
    return defToRow(inserted);
  }

  async update(id: string, patch: Partial<NewConnectedAppDefinition>): Promise<ConnectedAppDefinitionRow | null> {
    const [row] = await this.q
      .update(schema.integrationsConnectedAppDefinitions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.integrationsConnectedAppDefinitions.id, id))
      .returning();
    return row ? defToRow(row) : null;
  }

  async deleteWithConnections(id: string): Promise<{ appKey: string; deletedConnections: number } | null> {
    return withTransaction(this.db, async (tx) => {
      const [definition] = await tx
        .delete(schema.integrationsConnectedAppDefinitions)
        .where(eq(schema.integrationsConnectedAppDefinitions.id, id))
        .returning({ appKey: schema.integrationsConnectedAppDefinitions.appKey });
      if (!definition) return null;
      const removed = await tx
        .delete(schema.integrationsUserAppConnections)
        .where(eq(schema.integrationsUserAppConnections.appKey, definition.appKey))
        .returning({ id: schema.integrationsUserAppConnections.id });
      return { appKey: definition.appKey, deletedConnections: removed.length };
    });
  }
}

export class PgUserAppConnectionStore implements UserAppConnectionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private activeFilter(userId: string, appKey: string): SQL {
    return and(
      eq(schema.integrationsUserAppConnections.userId, userId),
      eq(schema.integrationsUserAppConnections.appKey, appKey),
      eq(schema.integrationsUserAppConnections.status, 'active'),
    )!;
  }

  async findActive(userId: string, appKey: string): Promise<UserAppConnectionRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsUserAppConnections)
      .where(this.activeFilter(userId, appKey))
      .limit(1);
    return row ? connToRow(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<UserAppConnectionRow | null> {
    const rows = await this.q
      .select()
      .from(schema.integrationsUserAppConnections)
      .where(eq(schema.integrationsUserAppConnections.id, id))
      .for('update')
      .limit(1);
    return rows[0] ? connToRow(rows[0]) : null;
  }

  async findByUserAndApp(userId: string, appKey: string): Promise<UserAppConnectionRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.integrationsUserAppConnections)
      .where(and(
        eq(schema.integrationsUserAppConnections.userId, userId),
        eq(schema.integrationsUserAppConnections.appKey, appKey),
      ))
      .limit(1);
    return row ? connToRow(row) : null;
  }

  async countActive(userId: string, appKey: string): Promise<number> {
    const [tally] = await this.q
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.integrationsUserAppConnections)
      .where(this.activeFilter(userId, appKey));
    return tally?.n ?? 0;
  }

  async listByUser(userId: string): Promise<UserAppConnectionRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsUserAppConnections)
      .where(eq(schema.integrationsUserAppConnections.userId, userId));
    return rows.map(connToRow);
  }

  async listActiveByUser(userId: string): Promise<UserAppConnectionRow[]> {
    const rows = await this.q
      .select()
      .from(schema.integrationsUserAppConnections)
      .where(and(
        eq(schema.integrationsUserAppConnections.userId, userId),
        eq(schema.integrationsUserAppConnections.status, 'active'),
      ));
    return rows.map(connToRow);
  }

  async countByAppKey(appKey: string): Promise<number> {
    const [tally] = await this.q
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.integrationsUserAppConnections)
      .where(eq(schema.integrationsUserAppConnections.appKey, appKey));
    return tally?.n ?? 0;
  }

  async upsertOnCallback(userId: string, appKey: string, payload: UpsertConnectionPayload): Promise<UserAppConnectionRow> {
    const [row] = await this.q
      .insert(schema.integrationsUserAppConnections)
      .values({
        id: newObjectId(),
        userId,
        appKey,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? null,
        tokenExpiresAt: payload.tokenExpiresAt ?? null,
        scopes: payload.scopes,
        providerAccountId: payload.providerAccountId ?? null,
        providerEmail: payload.providerEmail ?? null,
        status: payload.status,
        errorMessage: payload.errorMessage ?? null,
        lastRefreshedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.integrationsUserAppConnections.userId, schema.integrationsUserAppConnections.appKey],
        set: {
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken ?? null,
          tokenExpiresAt: payload.tokenExpiresAt ?? null,
          scopes: payload.scopes,
          providerAccountId: payload.providerAccountId ?? null,
          providerEmail: payload.providerEmail ?? null,
          status: payload.status,
          errorMessage: payload.errorMessage ?? null,
          lastRefreshedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return connToRow(row);
  }

  async insertForImport(userId: string, appKey: string, payload: UpsertConnectionPayload): Promise<UserAppConnectionRow> {
    const [row] = await this.q
      .insert(schema.integrationsUserAppConnections)
      .values({
        id: newObjectId(),
        userId,
        appKey,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? null,
        tokenExpiresAt: payload.tokenExpiresAt ?? null,
        scopes: payload.scopes,
        providerAccountId: payload.providerAccountId ?? null,
        providerEmail: payload.providerEmail ?? null,
        status: payload.status,
        errorMessage: payload.errorMessage ?? null,
      })
      .onConflictDoNothing({
        target: [schema.integrationsUserAppConnections.userId, schema.integrationsUserAppConnections.appKey],
      })
      .returning();
    return connToRow(row);
  }

  async updateById(id: string, patch: Partial<UpsertConnectionPayload> & { lastRefreshedAt?: Date | null; lastUsedAt?: Date | null }): Promise<void> {
    const { accessToken, refreshToken, tokenExpiresAt, scopes, providerAccountId, providerEmail, status, errorMessage, lastRefreshedAt, lastUsedAt } = patch;
    await this.q
      .update(schema.integrationsUserAppConnections)
      .set({
        ...(accessToken !== undefined ? { accessToken } : {}),
        ...(refreshToken !== undefined ? { refreshToken } : {}),
        ...(tokenExpiresAt !== undefined ? { tokenExpiresAt } : {}),
        ...(scopes !== undefined ? { scopes } : {}),
        ...(providerAccountId !== undefined ? { providerAccountId } : {}),
        ...(providerEmail !== undefined ? { providerEmail } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(errorMessage !== undefined ? { errorMessage } : {}),
        ...(lastRefreshedAt !== undefined ? { lastRefreshedAt } : {}),
        ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationsUserAppConnections.id, id));
  }

  async touchLastUsedThrottled(id: string): Promise<void> {
    // Plan 3.2: one write per minute per row instead of one per call.
    await this.q
      .update(schema.integrationsUserAppConnections)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.integrationsUserAppConnections.id, id),
        sql`(${schema.integrationsUserAppConnections.lastUsedAt} IS NULL OR ${schema.integrationsUserAppConnections.lastUsedAt} < now() - interval '60 seconds')`,
      ));
  }

  async markInactive(id: string, status: UserAppConnectionRow['status'], errorMessage: string): Promise<void> {
    await this.q
      .update(schema.integrationsUserAppConnections)
      .set({ status, errorMessage, updatedAt: new Date() })
      .where(and(
        eq(schema.integrationsUserAppConnections.id, id),
        eq(schema.integrationsUserAppConnections.status, 'active'),
      ));
  }

  async applyRefresh(id: string, payload: { accessToken: string; refreshToken?: string; tokenExpiresAt: Date | null }): Promise<void> {
    await this.q
      .update(schema.integrationsUserAppConnections)
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
        eq(schema.integrationsUserAppConnections.id, id),
        eq(schema.integrationsUserAppConnections.status, 'active'),
      ));
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(schema.integrationsUserAppConnections).where(eq(schema.integrationsUserAppConnections.id, id));
  }
}

export class PgConnectedAppOauthStateStore implements ConnectedAppOauthStateStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(row: { state: string; appKey: string; userId: string; codeVerifier?: string | null; expiresAt: Date }): Promise<void> {
    await this.q
      .insert(schema.integrationsConnectedAppOauthStates)
      .values({ id: newObjectId(), ...row, codeVerifier: row.codeVerifier ?? null });
  }

  async consume(state: string): Promise<ConnectedAppOauthStateRow | null> {
    const conditions: SQL[] = [
      eq(schema.integrationsConnectedAppOauthStates.state, state),
      gt(schema.integrationsConnectedAppOauthStates.expiresAt, new Date()),
    ];
    const [row] = await this.q
      .delete(schema.integrationsConnectedAppOauthStates)
      .where(and(...conditions))
      .returning();
    if (!row) return null;
    return {
      id: row.id,
      state: row.state,
      appKey: row.appKey,
      userId: row.userId,
      codeVerifier: row.codeVerifier ?? null,
      expiresAt: row.expiresAt,
    };
  }

  async exists(state: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: schema.integrationsConnectedAppOauthStates.id })
      .from(schema.integrationsConnectedAppOauthStates)
      .where(and(
        eq(schema.integrationsConnectedAppOauthStates.state, state),
        gt(schema.integrationsConnectedAppOauthStates.expiresAt, new Date()),
      ))
      .limit(1);
    return rows.length > 0;
  }
}
