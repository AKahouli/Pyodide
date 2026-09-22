import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { isObjectId, newObjectId } from '@common/postgres';
import { isUniqueViolation } from '@common/postgres/errors';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { PopulatedGroupRecord, UserGroupStore } from './user-group.store';

type GroupRow = typeof schema.identityUserGroups.$inferSelect;

/** PostgreSQL identity.user_groups implementation (plan 1A.12). */
export class PgUserGroupStore implements UserGroupStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Members joined per group id; deleted users simply do not join. */
  private async attachMembers(groups: GroupRow[]): Promise<PopulatedGroupRecord[]> {
    if (groups.length === 0) return [];
    const memberRows = await this.q
      .select({
        groupId: schema.identityUserGroupMembers.groupId,
        position: schema.identityUserGroupMembers.position,
        id: schema.identityUsers.id,
        email: schema.identityUsers.email,
        firstName: schema.identityUsers.firstName,
        lastName: schema.identityUsers.lastName,
      })
      .from(schema.identityUserGroupMembers)
      .innerJoin(schema.identityUsers, eq(schema.identityUsers.id, schema.identityUserGroupMembers.userId))
      .where(inArray(schema.identityUserGroupMembers.groupId, groups.map((g) => g.id)))
      .orderBy(asc(schema.identityUserGroupMembers.position));

    const byGroup = new Map<string, PopulatedGroupRecord['members']>();
    for (const row of memberRows) {
      const list = byGroup.get(row.groupId) ?? [];
      list.push({ id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName });
      byGroup.set(row.groupId, list);
    }
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      createdBy: g.createdBy,
      members: byGroup.get(g.id) ?? [],
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    }));
  }

  async create(init: { ownerId: string; name: string; description: string; memberIds: string[] }): Promise<PopulatedGroupRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const id = newObjectId();
        const rows: GroupRow[] = await tx
          .insert(schema.identityUserGroups)
          .values({ id, name: init.name, description: init.description, createdBy: init.ownerId })
          .returning();
        const validMembers = [...new Set(init.memberIds)].filter(isObjectId);
        if (validMembers.length > 0) {
          await tx
            .insert(schema.identityUserGroupMembers)
            .values(validMembers.map((userId, position) => ({ groupId: id, userId, position })))
            .onConflictDoNothing();
        }
        return (await this.attachMembers(rows))[0];
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_user_groups_owner_name')) {
        // Race with the service's pre-check: surface the same 409.
        throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
      }
      throw error;
    }
  }

  async existsOwnedByName(ownerId: string, name: string, excludeId?: string): Promise<boolean> {
    const conditions = [eq(schema.identityUserGroups.createdBy, ownerId), eq(schema.identityUserGroups.name, name)];
    if (excludeId) conditions.push(ne(schema.identityUserGroups.id, excludeId));
    const rows = await this.q
      .select({ exists: sql<boolean>`true` })
      .from(schema.identityUserGroups)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  async findAllForUser(ownerId: string): Promise<PopulatedGroupRecord[]> {
    if (!isObjectId(ownerId)) return [];
    const groups: GroupRow[] = await this.q
      .select()
      .from(schema.identityUserGroups)
      .where(eq(schema.identityUserGroups.createdBy, ownerId))
      .orderBy(desc(schema.identityUserGroups.createdAt));
    return this.attachMembers(groups);
  }

  async findOwnedById(ownerId: string, id: string): Promise<PopulatedGroupRecord | null> {
    if (!isObjectId(id) || !isObjectId(ownerId)) return null;
    const groups: GroupRow[] = await this.q
      .select()
      .from(schema.identityUserGroups)
      .where(and(eq(schema.identityUserGroups.id, id), eq(schema.identityUserGroups.createdBy, ownerId)))
      .limit(1);
    return (await this.attachMembers(groups))[0] ?? null;
  }

  async findOwnedByIds(ownerId: string, ids: string[]): Promise<PopulatedGroupRecord[]> {
    const valid = [...new Set(ids)].filter(isObjectId);
    if (valid.length === 0 || !isObjectId(ownerId)) return [];
    const groups: GroupRow[] = await this.q
      .select()
      .from(schema.identityUserGroups)
      .where(and(inArray(schema.identityUserGroups.id, valid), eq(schema.identityUserGroups.createdBy, ownerId)));
    return this.attachMembers(groups);
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<void> {
    if (!isObjectId(id)) return;
    try {
      await this.q
        .update(schema.identityUserGroups)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.identityUserGroups.id, id));
    } catch (error) {
      if (isUniqueViolation(error, 'uq_user_groups_owner_name')) {
        throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
      }
      throw error;
    }
  }

  async deleteById(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q.delete(schema.identityUserGroups).where(eq(schema.identityUserGroups.id, id));
  }

  async addMembers(id: string, userIds: string[]): Promise<void> {
    if (!isObjectId(id)) return;
    const valid = [...new Set(userIds)].filter(isObjectId);
    if (valid.length === 0) return;
    // $addToSet parity, distinct positions (R-11): a per-row MAX subquery sees
    // the pre-statement snapshot, so a whole batch would share one position.
    const values = sql.join(
      valid.map((userId, ord) => sql`(${userId}, ${ord}::int)`),
      sql`, `,
    );
    await this.q.execute(sql`
      WITH base AS (
        SELECT COALESCE(MAX(position), -1) + 1 AS next
        FROM identity.user_group_members WHERE group_id = ${id}
      )
      INSERT INTO identity.user_group_members (group_id, user_id, position)
      SELECT ${id}, u.id, (SELECT next FROM base) + u.ord
      FROM (VALUES ${values}) AS u(id, ord)
      ON CONFLICT DO NOTHING
    `);
  }

  async removeMember(id: string, memberId: string): Promise<void> {
    if (!isObjectId(id) || !isObjectId(memberId)) return;
    await this.q
      .delete(schema.identityUserGroupMembers)
      .where(and(eq(schema.identityUserGroupMembers.groupId, id), eq(schema.identityUserGroupMembers.userId, memberId)));
  }

  async findOwnedGroupIdsForMember(ownerId: string, memberId: string): Promise<string[]> {
    if (!isObjectId(memberId) || !isObjectId(ownerId)) return [];
    const rows = await this.q
      .select({ id: schema.identityUserGroups.id })
      .from(schema.identityUserGroups)
      .innerJoin(schema.identityUserGroupMembers, eq(schema.identityUserGroupMembers.groupId, schema.identityUserGroups.id))
      .where(and(eq(schema.identityUserGroups.createdBy, ownerId), eq(schema.identityUserGroupMembers.userId, memberId)));
    return rows.map((r) => r.id);
  }

  async findGroupIdsForMember(memberId: string): Promise<string[]> {
    if (!isObjectId(memberId)) return [];
    const rows = await this.q
      .select({ id: schema.identityUserGroupMembers.groupId })
      .from(schema.identityUserGroupMembers)
      .where(eq(schema.identityUserGroupMembers.userId, memberId));
    return rows.map((r) => r.id);
  }
}
