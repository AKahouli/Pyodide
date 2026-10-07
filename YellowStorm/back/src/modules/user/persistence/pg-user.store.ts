import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { isUniqueViolation } from '@common/postgres/errors';
import { resolveQueryable, withTransaction } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import { escapeLike } from '@common/postgres/like';
import {
  AdminUserFilter,
  NewUser,
  RoleRef,
  UserPatch,
  UserRecord,
  UserRecordWithRoles,
  UserSearchHit,
  UserStore,
} from './user.store';
import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { toSearchHit } from './user-record.mapper';

type UserRow = typeof schema.identityUsers.$inferSelect;
type UserRoleRow = typeof schema.identityUserRoles.$inferSelect;
type RoleRow = typeof schema.authzRoles.$inferSelect;

/**
 * PostgreSQL identity.users implementation of UserStore (plan 1A.1).
 * Reads/writes flat rows; junction tables carry role order and group members.
 */
export class PgUserStore implements UserStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): NodePgDatabase<typeof schema> {
    return resolveQueryable(this.db);
  }

  private static toRecord(row: UserRow): UserRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      emailVerified: row.emailVerified,
      emailVerificationToken: row.emailVerificationToken,
      emailVerificationExpiry: row.emailVerificationExpiry,
      passwordResetToken: row.passwordResetToken,
      passwordResetExpiry: row.passwordResetExpiry,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      profileRole: row.profileRole,
      description: row.description,
      colorTheme: row.colorTheme as UserRecord['colorTheme'],
      language: row.language,
      consentPrivacyPolicy: row.consentPrivacyPolicy,
      consentPrivacyPolicyAcceptedAt: row.consentPrivacyPolicyAcceptedAt,
      consentDataSharing: row.consentDataSharing,
      consentDataSharingAcceptedAt: row.consentDataSharingAcceptedAt,
      profileComplete: row.profileComplete,
      microsoftAccountId: row.microsoftAccountId,
      planId: row.planId,
      planSlug: row.planSlug,
      planStartedAt: row.planStartedAt,
      appBuilderAiOfferId: row.appBuilderAiOfferId,
      appBuilderAiOfferStartedAt: row.appBuilderAiOfferStartedAt,
      roleIds: [],
      permissionsVersion: row.permissionsVersion,
      status: row.status as UserRecord['status'],
      registrationApproval: row.registrationApproval as UserRecord['registrationApproval'],
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** roleIds for the given users, ordered by junction position. */
  private async loadRoleIds(userIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (userIds.length === 0) return out;
    const rows: UserRoleRow[] = await this.q
      .select()
      .from(schema.identityUserRoles)
      .where(inArray(schema.identityUserRoles.userId, userIds))
      .orderBy(asc(schema.identityUserRoles.position));
    for (const row of rows) {
      const list = out.get(row.userId) ?? [];
      list.push(row.roleId);
      out.set(row.userId, list);
    }
    return out;
  }

  private async hydrateRoles(rows: UserRow[]): Promise<UserRecord[]> {
    const records = rows.map(PgUserStore.toRecord);
    const byRole = await this.loadRoleIds(records.map((r) => r.id));
    for (const record of records) record.roleIds = byRole.get(record.id) ?? [];
    return records;
  }

  async findById(id: string): Promise<UserRecord | null> {
    if (!isObjectId(id)) return null;
    const rows: UserRow[] = await this.q.select().from(schema.identityUsers).where(eq(schema.identityUsers.id, id)).limit(1);
    if (rows.length === 0) return null;
    const [record] = await this.hydrateRoles(rows);
    return record;
  }

  async findByIds(ids: string[]): Promise<Map<string, UserRecord>> {
    const valid = ids.filter(isObjectId);
    if (valid.length === 0) return new Map();
    const rows: UserRow[] = await this.q.select().from(schema.identityUsers).where(inArray(schema.identityUsers.id, valid));
    const records = await this.hydrateRoles(rows);
    return new Map(records.map((record) => [record.id, record]));
  }

  async findByIdWithRoles(id: string): Promise<UserRecordWithRoles | null> {
    const record = await this.findById(id);
    if (!record) return null;
    return { ...record, roles: await this.roleRefs(record.roleIds) };
  }

  private async roleRefs(roleIds: string[]): Promise<RoleRef[]> {
    if (roleIds.length === 0) return [];
    const rows: Pick<RoleRow, 'id' | 'name'>[] = await this.q
      .select({ id: schema.authzRoles.id, name: schema.authzRoles.name })
      .from(schema.authzRoles)
      .where(inArray(schema.authzRoles.id, roleIds));
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    return roleIds.map((id) => ({ id, name: byId.get(id) ?? '' }));
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const rows: UserRow[] = await this.q
      .select()
      .from(schema.identityUsers)
      .where(eq(schema.identityUsers.email, email.toLowerCase()))
      .limit(1);
    if (rows.length === 0) return null;
    const [record] = await this.hydrateRoles(rows);
    return record;
  }

  async findByEmails(emails: string[]): Promise<Map<string, UserRecord>> {
    const normalized = [...new Set(emails.map((e) => e.toLowerCase()))];
    if (normalized.length === 0) return new Map();
    const rows: UserRow[] = await this.q.select().from(schema.identityUsers).where(inArray(schema.identityUsers.email, normalized));
    const records = await this.hydrateRoles(rows);
    return new Map(records.map((record) => [record.email, record]));
  }

  async findByVerificationToken(token: string): Promise<UserRecord | null> {
    const rows: UserRow[] = await this.q
      .select()
      .from(schema.identityUsers)
      .where(eq(schema.identityUsers.emailVerificationToken, token))
      .limit(1);
    return rows.length ? (await this.hydrateRoles(rows))[0] : null;
  }

  async findByResetTokenHash(tokenHash: string): Promise<UserRecord | null> {
    const rows: UserRow[] = await this.q
      .select()
      .from(schema.identityUsers)
      .where(eq(schema.identityUsers.passwordResetToken, tokenHash))
      .limit(1);
    return rows.length ? (await this.hydrateRoles(rows))[0] : null;
  }

  async findByMicrosoftAccountId(microsoftAccountId: string): Promise<UserRecord | null> {
    const rows: UserRow[] = await this.q
      .select()
      .from(schema.identityUsers)
      .where(eq(schema.identityUsers.microsoftAccountId, microsoftAccountId))
      .limit(1);
    return rows.length ? (await this.hydrateRoles(rows))[0] : null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const rows = await this.q
      .select({ exists: sql<boolean>`true` })
      .from(schema.identityUsers)
      .where(eq(schema.identityUsers.email, email.toLowerCase()))
      .limit(1);
    return rows.length > 0;
  }

  async create(init: NewUser): Promise<UserRecord> {
    const id = newObjectId();
    try {
      // User + role junction in one transaction (R-15): a partial insert must
      // not survive a junction failure.
      const record = await withTransaction(this.db, async (tx) => {
        const rows: UserRow[] = await tx
          .insert(schema.identityUsers)
          .values({
            id,
            email: init.email.toLowerCase(),
            passwordHash: init.passwordHash,
            emailVerified: init.emailVerified ?? false,
            emailVerificationToken: init.emailVerificationToken ?? null,
            emailVerificationExpiry: init.emailVerificationExpiry ?? null,
            firstName: init.firstName ?? null,
            lastName: init.lastName ?? null,
            company: init.company ?? null,
            profileRole: init.profileRole ?? '',
            description: init.description ?? '',
            microsoftAccountId: init.microsoftAccountId ?? null,
            profileComplete: init.profileComplete ?? false,
            status: init.status ?? 'active',
            registrationApproval: init.registrationApproval ?? null,
          })
          .returning();
        if (init.roleIds?.length) {
          await tx
            .insert(schema.identityUserRoles)
            .values(init.roleIds.map((roleId, position) => ({ userId: id, roleId, position })))
            .onConflictDoNothing();
        }
        const record = PgUserStore.toRecord(rows[0]);
        record.roleIds = init.roleIds ?? [];
        return record;
      });
      return record;
    } catch (error) {
      if (isUniqueViolation(error, 'uq_users_email')) {
        // Race with the service's pre-check: surface the same 409.
        throw new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered');
      }
      throw error;
    }
  }

  async update(id: string, patch: UserPatch): Promise<UserRecord | null> {
    if (!isObjectId(id)) return null;
    const values: Partial<typeof schema.identityUsers.$inferInsert> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      (values as Record<string, unknown>)[key] = value;
    }
    const rows: UserRow[] = await this.q
      .update(schema.identityUsers)
      .set(values)
      .where(eq(schema.identityUsers.id, normalizeObjectId(id)))
      .returning();
    if (rows.length === 0) return null;
    const [record] = await this.hydrateRoles(rows);
    return record;
  }

  private searchFilter(q: string, excludeUserId?: string) {
    const pattern = `%${escapeLike(q.trim())}%`;
    const conditions = [
      eq(schema.identityUsers.status, 'active'),
      or(
        ilike(schema.identityUsers.email, pattern),
        ilike(schema.identityUsers.firstName, pattern),
        ilike(schema.identityUsers.lastName, pattern),
      ),
    ];
    if (excludeUserId && isObjectId(excludeUserId)) conditions.push(ne(schema.identityUsers.id, excludeUserId));
    return and(...conditions);
  }

  async searchActive(q: string, options: { excludeUserId?: string; limit: number }): Promise<UserSearchHit[]> {
    if (q.trim().length === 0) return [];
    const rows = await this.q
      .select({ id: schema.identityUsers.id, email: schema.identityUsers.email, firstName: schema.identityUsers.firstName, lastName: schema.identityUsers.lastName })
      .from(schema.identityUsers)
      .where(this.searchFilter(q, options.excludeUserId))
      .limit(options.limit);
    return rows.map(toSearchHit);
  }

  async listActive(options: { excludeUserId?: string; limit: number }): Promise<UserSearchHit[]> {
    const conditions = [eq(schema.identityUsers.status, 'active')];
    if (options.excludeUserId && isObjectId(options.excludeUserId)) {
      conditions.push(ne(schema.identityUsers.id, options.excludeUserId));
    }
    const rows = await this.q
      .select({ id: schema.identityUsers.id, email: schema.identityUsers.email, firstName: schema.identityUsers.firstName, lastName: schema.identityUsers.lastName })
      .from(schema.identityUsers)
      .where(and(...conditions))
      .orderBy(asc(schema.identityUsers.email))
      .limit(options.limit);
    return rows.map(toSearchHit);
  }

  async findWithoutPlan(limit: number): Promise<UserRecord[]> {
    const rows: UserRow[] = await this.q
      .select()
      .from(schema.identityUsers)
      .where(isNull(schema.identityUsers.planId))
      .limit(limit);
    return this.hydrateRoles(rows);
  }

  async listAdmin(filter: AdminUserFilter): Promise<{ users: UserRecordWithRoles[]; total: number }> {
    const conditions = [];
    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      conditions.push(
        or(
          ilike(schema.identityUsers.email, pattern),
          ilike(schema.identityUsers.firstName, pattern),
          ilike(schema.identityUsers.lastName, pattern),
        ),
      );
    }
    if (filter.status) conditions.push(eq(schema.identityUsers.status, filter.status));
    if (filter.emailVerified !== undefined) conditions.push(eq(schema.identityUsers.emailVerified, filter.emailVerified));
    if (filter.profileComplete !== undefined) conditions.push(eq(schema.identityUsers.profileComplete, filter.profileComplete));
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn =
      filter.sortBy === 'email' ? schema.identityUsers.email : filter.sortBy === 'status' ? schema.identityUsers.status : schema.identityUsers.createdAt;
    const direction = filter.sortOrder === 'asc' ? asc : desc;
    const limit = filter.limit ?? 20;
    const offset = ((filter.page ?? 1) - 1) * limit;

    const rows = await this.q
      .select()
      .from(schema.identityUsers)
      .where(where)
      .orderBy(direction(sortColumn))
      .limit(limit)
      .offset(offset);

    const totalRows = await this.q
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.identityUsers)
      .where(where);

    // Attach roles for the page only (R-10): joining before LIMIT fans users
    // out per role and shrinks every page by the roles count.
    const rolesByUser = new Map<string, { id: string; name: string }[]>();
    if (rows.length > 0) {
      const roleRows = await this.q
        .select({
          userId: schema.identityUserRoles.userId,
          roleId: schema.identityUserRoles.roleId,
          roleName: schema.authzRoles.name,
        })
        .from(schema.identityUserRoles)
        .innerJoin(schema.authzRoles, eq(schema.authzRoles.id, schema.identityUserRoles.roleId))
        .where(inArray(schema.identityUserRoles.userId, rows.map((u) => u.id)))
        .orderBy(asc(schema.identityUserRoles.position));
      for (const row of roleRows) {
        const roles = rolesByUser.get(row.userId) ?? [];
        roles.push({ id: row.roleId, name: row.roleName ?? '' });
        rolesByUser.set(row.userId, roles);
      }
    }

    const users: UserRecordWithRoles[] = rows.map((user) => ({
      ...PgUserStore.toRecord(user),
      roles: rolesByUser.get(user.id) ?? [],
    }));
    return { users, total: totalRows[0]?.total ?? 0 };
  }

  async countByStatus(): Promise<Record<UserRecord['status'], number>> {
    const rows = await this.q
      .select({ status: schema.identityUsers.status, n: sql<number>`count(*)::int` })
      .from(schema.identityUsers)
      .groupBy(schema.identityUsers.status);
    const out: Record<UserRecord['status'], number> = { active: 0, inactive: 0, suspended: 0 };
    for (const row of rows) out[row.status as UserRecord['status']] = row.n;
    return out;
  }

  async findActiveByRole(roleId: string): Promise<UserRecord[]> {
    if (!isObjectId(roleId)) return [];
    const rows = await this.q
      .select({ user: schema.identityUsers })
      .from(schema.identityUserRoles)
      .innerJoin(schema.identityUsers, eq(schema.identityUsers.id, schema.identityUserRoles.userId))
      .where(and(eq(schema.identityUserRoles.roleId, roleId), eq(schema.identityUsers.status, 'active')));
    const records = rows.map((row) => PgUserStore.toRecord(row.user));
    const byRole = await this.loadRoleIds(records.map((r) => r.id));
    for (const record of records) record.roleIds = byRole.get(record.id) ?? [];
    return records;
  }

  async setColorThemeForAll(theme: 'default' | 'yellow' | 'orange' | 'blue'): Promise<void> {
    await this.q.update(schema.identityUsers).set({ colorTheme: theme, updatedAt: new Date() });
  }

  async addRole(userId: string, roleId: string): Promise<void> {
    if (!isObjectId(userId) || !isObjectId(roleId)) return;
    // Append at the end, mirroring Mongo $addToSet semantics.
    await this.q
      .insert(schema.identityUserRoles)
      .values({
        userId: normalizeObjectId(userId),
        roleId: normalizeObjectId(roleId),
        position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM identity.user_roles WHERE user_id = ${normalizeObjectId(userId)})`,
      })
      .onConflictDoNothing();
  }

  async removeRole(userId: string, roleId: string): Promise<void> {
    if (!isObjectId(userId) || !isObjectId(roleId)) return;
    await this.q
      .delete(schema.identityUserRoles)
      .where(and(eq(schema.identityUserRoles.userId, normalizeObjectId(userId)), eq(schema.identityUserRoles.roleId, normalizeObjectId(roleId))));
  }

  async removeRoleFromAll(roleId: string): Promise<void> {
    if (!isObjectId(roleId)) return;
    await this.q.delete(schema.identityUserRoles).where(eq(schema.identityUserRoles.roleId, roleId));
  }

  async bumpPermissionsVersion(userIds: string[]): Promise<void> {
    const valid = userIds.filter(isObjectId);
    if (valid.length === 0) return;
    await this.q
      .update(schema.identityUsers)
      .set({ permissionsVersion: sql`${schema.identityUsers.permissionsVersion} + 1`, updatedAt: new Date() })
      .where(inArray(schema.identityUsers.id, valid));
  }

  async addRoleAndBump(userId: string, roleId: string): Promise<void> {
    if (!isObjectId(userId) || !isObjectId(roleId)) return;
    await withTransaction(this.db, async (tx) => {
      await tx
        .insert(schema.identityUserRoles)
        .values({
          userId: normalizeObjectId(userId),
          roleId: normalizeObjectId(roleId),
          position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM identity.user_roles WHERE user_id = ${normalizeObjectId(userId)})`,
        })
        .onConflictDoNothing();
      await tx
        .update(schema.identityUsers)
        .set({ permissionsVersion: sql`${schema.identityUsers.permissionsVersion} + 1`, updatedAt: new Date() })
        .where(eq(schema.identityUsers.id, normalizeObjectId(userId)));
    });
  }

  async removeRoleAndBump(userId: string, roleId: string): Promise<void> {
    if (!isObjectId(userId) || !isObjectId(roleId)) return;
    await withTransaction(this.db, async (tx) => {
      await tx
        .delete(schema.identityUserRoles)
        .where(and(eq(schema.identityUserRoles.userId, normalizeObjectId(userId)), eq(schema.identityUserRoles.roleId, normalizeObjectId(roleId))));
      await tx
        .update(schema.identityUsers)
        .set({ permissionsVersion: sql`${schema.identityUsers.permissionsVersion} + 1`, updatedAt: new Date() })
        .where(eq(schema.identityUsers.id, normalizeObjectId(userId)));
    });
  }
}

