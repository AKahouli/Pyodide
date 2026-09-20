import { Inject } from '@nestjs/common';
import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { isObjectId, newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import type {
  AuthProviderPatch,
  AuthProviderRecord,
  AuthProviderStore,
  OAuthStateRecord,
  OAuthStateStore,
  ProviderLinkTokenRecord,
  ProviderLinkTokenStore,
  UserProviderLinkRecord,
  UserProviderLinkStore,
} from './auth-provider.stores';

type ProviderRow = typeof schema.identityAuthProviders.$inferSelect;
type StateRow = typeof schema.identityOauthStates.$inferSelect;
type TokenRow = typeof schema.identityProviderLinkTokens.$inferSelect;
type LinkRow = typeof schema.identityUserProviderLinks.$inferSelect;

function toProviderRecord(row: ProviderRow): AuthProviderRecord {
  return {
    id: row.id,
    providerKey: row.providerKey,
    displayName: row.displayName,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    tenantId: row.tenantId,
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userinfoUrl: row.userinfoUrl,
    scopes: row.scopes,
    iconKey: row.iconKey,
    sortOrder: row.sortOrder,
    pkceEnabled: row.pkceEnabled,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgAuthProviderStore implements AuthProviderStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findAll(): Promise<AuthProviderRecord[]> {
    const rows: ProviderRow[] = await this.q.select().from(schema.identityAuthProviders).orderBy(asc(schema.identityAuthProviders.sortOrder));
    return rows.map(toProviderRecord);
  }

  async findAllEnabled(): Promise<AuthProviderRecord[]> {
    const rows: ProviderRow[] = await this.q
      .select()
      .from(schema.identityAuthProviders)
      .where(eq(schema.identityAuthProviders.enabled, true))
      .orderBy(asc(schema.identityAuthProviders.sortOrder));
    return rows.map(toProviderRecord);
  }

  async findById(id: string): Promise<AuthProviderRecord | null> {
    if (!isObjectId(id)) return null;
    const rows: ProviderRow[] = await this.q.select().from(schema.identityAuthProviders).where(eq(schema.identityAuthProviders.id, id)).limit(1);
    return rows.length ? toProviderRecord(rows[0]) : null;
  }

  async findByKey(providerKey: string): Promise<AuthProviderRecord | null> {
    const rows: ProviderRow[] = await this.q
      .select()
      .from(schema.identityAuthProviders)
      .where(eq(schema.identityAuthProviders.providerKey, providerKey))
      .limit(1);
    return rows.length ? toProviderRecord(rows[0]) : null;
  }

  async existsByKey(providerKey: string, excludeId?: string): Promise<boolean> {
    const conditions = [eq(schema.identityAuthProviders.providerKey, providerKey)];
    if (excludeId) conditions.push(ne(schema.identityAuthProviders.id, excludeId));
    const rows = await this.q
      .select({ exists: sql<boolean>`true` })
      .from(schema.identityAuthProviders)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  async create(init: Omit<AuthProviderRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AuthProviderRecord> {
    const rows: ProviderRow[] = await this.q
      .insert(schema.identityAuthProviders)
      .values({ ...init, id: newObjectId() })
      .returning();
    return toProviderRecord(rows[0]);
  }

  async update(id: string, patch: AuthProviderPatch): Promise<AuthProviderRecord | null> {
    if (!isObjectId(id)) return null;
    const rows: ProviderRow[] = await this.q
      .update(schema.identityAuthProviders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.identityAuthProviders.id, id))
      .returning();
    return rows.length ? toProviderRecord(rows[0]) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q.delete(schema.identityAuthProviders).where(eq(schema.identityAuthProviders.id, id)).returning();
    return rows.length > 0;
  }
}

function toStateRecord(row: StateRow): OAuthStateRecord {
  return {
    id: row.id,
    state: row.state,
    providerKey: row.providerKey,
    codeVerifier: row.codeVerifier,
    returnUrl: row.returnUrl,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgOAuthStateStore implements OAuthStateStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(init: Omit<OAuthStateRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<OAuthStateRecord> {
    const rows: StateRow[] = await this.q.insert(schema.identityOauthStates).values({ ...init, id: newObjectId() }).returning();
    return toStateRecord(rows[0]);
  }

  async consumeByState(state: string): Promise<OAuthStateRecord | null> {
    const rows: StateRow[] = await this.q
      .delete(schema.identityOauthStates)
      .where(and(eq(schema.identityOauthStates.state, state), gt(schema.identityOauthStates.expiresAt, new Date())))
      .returning();
    return rows.length ? toStateRecord(rows[0]) : null;
  }
}

function toTokenRecord(row: TokenRow): ProviderLinkTokenRecord {
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    providerKey: row.providerKey,
    providerUserId: row.providerUserId,
    providerEmail: row.providerEmail,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgProviderLinkTokenStore implements ProviderLinkTokenStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(init: Omit<ProviderLinkTokenRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderLinkTokenRecord> {
    const rows: TokenRow[] = await this.q
      .insert(schema.identityProviderLinkTokens)
      .values({ ...init, id: newObjectId() })
      .returning();
    return toTokenRecord(rows[0]);
  }

  async consumeByToken(token: string): Promise<ProviderLinkTokenRecord | null> {
    const rows: TokenRow[] = await this.q
      .delete(schema.identityProviderLinkTokens)
      .where(and(eq(schema.identityProviderLinkTokens.token, token), gt(schema.identityProviderLinkTokens.expiresAt, new Date())))
      .returning();
    return rows.length ? toTokenRecord(rows[0]) : null;
  }

  async consumeByTokenAndProviderKey(token: string, providerKey: string): Promise<ProviderLinkTokenRecord | null> {
    const rows: TokenRow[] = await this.q
      .delete(schema.identityProviderLinkTokens)
      .where(
        and(
          eq(schema.identityProviderLinkTokens.token, token),
          eq(schema.identityProviderLinkTokens.providerKey, providerKey),
          gt(schema.identityProviderLinkTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    return rows.length ? toTokenRecord(rows[0]) : null;
  }
}

function toLinkRecord(row: LinkRow): UserProviderLinkRecord {
  return {
    id: row.id,
    userId: row.userId,
    providerKey: row.providerKey,
    providerUserId: row.providerUserId,
    providerEmail: row.providerEmail,
    linkedAt: row.linkedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgUserProviderLinkStore implements UserProviderLinkStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findByProvider(providerKey: string, providerUserId: string): Promise<UserProviderLinkRecord | null> {
    const rows: LinkRow[] = await this.q
      .select()
      .from(schema.identityUserProviderLinks)
      .where(and(eq(schema.identityUserProviderLinks.providerKey, providerKey), eq(schema.identityUserProviderLinks.providerUserId, providerUserId)))
      .limit(1);
    return rows.length ? toLinkRecord(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<UserProviderLinkRecord[]> {
    if (!isObjectId(userId)) return [];
    const rows: LinkRow[] = await this.q
      .select()
      .from(schema.identityUserProviderLinks)
      .where(eq(schema.identityUserProviderLinks.userId, userId))
      .orderBy(asc(schema.identityUserProviderLinks.linkedAt));
    return rows.map(toLinkRecord);
  }

  async create(init: Omit<UserProviderLinkRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserProviderLinkRecord> {
    const rows: LinkRow[] = await this.q
      .insert(schema.identityUserProviderLinks)
      .values({ ...init, id: newObjectId() })
      .returning();
    return toLinkRecord(rows[0]);
  }

  async deleteByUserAndProvider(userId: string, providerKey: string): Promise<boolean> {
    if (!isObjectId(userId)) return false;
    const rows = await this.q
      .delete(schema.identityUserProviderLinks)
      .where(and(eq(schema.identityUserProviderLinks.userId, userId), eq(schema.identityUserProviderLinks.providerKey, providerKey)))
      .returning();
    return rows.length > 0;
  }

  async countByUserExcluding(userId: string, providerKey: string): Promise<number> {
    if (!isObjectId(userId)) return 0;
    const rows = await this.q
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.identityUserProviderLinks)
      .where(and(eq(schema.identityUserProviderLinks.userId, userId), ne(schema.identityUserProviderLinks.providerKey, providerKey)));
    return rows[0]?.n ?? 0;
  }
}
