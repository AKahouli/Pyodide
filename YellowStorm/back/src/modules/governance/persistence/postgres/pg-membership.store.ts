import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { MEMBERSHIP_STORE, type GovernanceMembershipCreateInput, type GovernanceMembershipPatch, type MembershipStore } from '../membership-store';
import { DuplicateKeyError, type GovernanceMembershipRecord } from '../governance-records';

const MEMBERSHIPS = schema.governanceMemberships;
type MembershipRow = typeof MEMBERSHIPS.$inferSelect;

export function membershipRowToRecord(row: MembershipRow): GovernanceMembershipRecord {
  return {
    id: row.id,
    programId: row.programId,
    scopeId: row.scopeId ?? undefined,
    userId: row.userId ?? undefined,
    groupId: row.groupId ?? undefined,
    invitedBy: row.invitedBy,
    role: row.role as GovernanceMembershipRecord['role'],
    status: row.status as GovernanceMembershipRecord['status'],
    permissions: row.permissions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

@Injectable()
export class PgMembershipStore implements MembershipStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async insert(input: GovernanceMembershipCreateInput): Promise<GovernanceMembershipRecord> {
    try {
      const [row] = await this.q
        .insert(MEMBERSHIPS)
        .values({
          id: newObjectId(),
          programId: input.programId,
          scopeId: input.scopeId ?? null,
          userId: input.userId ?? null,
          groupId: input.groupId ?? null,
          invitedBy: input.invitedBy,
          role: input.role,
          status: input.status,
          permissions: input.permissions,
        })
        .returning();
      return membershipRowToRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateKeyError('membership already exists');
      throw error;
    }
  }

  async findById(membershipId: string): Promise<GovernanceMembershipRecord | null> {
    const rows = await this.q.select().from(MEMBERSHIPS).where(eq(MEMBERSHIPS.id, membershipId)).limit(1);
    return rows[0] ? membershipRowToRecord(rows[0]) : null;
  }

  async findByIdAndProgram(programId: string, membershipId: string): Promise<GovernanceMembershipRecord | null> {
    const rows = await this.q
      .select()
      .from(MEMBERSHIPS)
      .where(and(eq(MEMBERSHIPS.id, membershipId), eq(MEMBERSHIPS.programId, programId)))
      .limit(1);
    return rows[0] ? membershipRowToRecord(rows[0]) : null;
  }

  async findDuplicate(programId: string, scopeId: string | null, target: { userId?: string; groupId?: string }): Promise<GovernanceMembershipRecord | null> {
    const rows = await this.q
      .select()
      .from(MEMBERSHIPS)
      .where(
        and(
          eq(MEMBERSHIPS.programId, programId),
          scopeId === null ? isNull(MEMBERSHIPS.scopeId) : eq(MEMBERSHIPS.scopeId, scopeId),
          target.userId ? eq(MEMBERSHIPS.userId, target.userId) : eq(MEMBERSHIPS.groupId, target.groupId as string),
        ),
      )
      .limit(1);
    return rows[0] ? membershipRowToRecord(rows[0]) : null;
  }

  async findActiveForUser(programId: string, userId: string, groupIds: string[]): Promise<GovernanceMembershipRecord[]> {
    const rows = await this.q
      .select()
      .from(MEMBERSHIPS)
      .where(
        and(
          eq(MEMBERSHIPS.programId, programId),
          eq(MEMBERSHIPS.status, 'active'),
          groupIds.length
            ? or(eq(MEMBERSHIPS.userId, userId), inArray(MEMBERSHIPS.groupId, groupIds))
            : eq(MEMBERSHIPS.userId, userId),
        ),
      );
    return rows.map(membershipRowToRecord);
  }

  async findActiveByUser(userId: string): Promise<GovernanceMembershipRecord[]> {
    const rows = await this.q
      .select({ programId: MEMBERSHIPS.programId })
      .from(MEMBERSHIPS)
      .where(and(eq(MEMBERSHIPS.userId, userId), eq(MEMBERSHIPS.status, 'active')));
    return rows.map((row) => ({ programId: row.programId }) as GovernanceMembershipRecord);
  }

  async listByProgram(programId: string): Promise<GovernanceMembershipRecord[]> {
    const rows = await this.q.select().from(MEMBERSHIPS).where(eq(MEMBERSHIPS.programId, programId)).orderBy(desc(MEMBERSHIPS.createdAt));
    return rows.map(membershipRowToRecord);
  }

  async countByProgram(programId: string): Promise<number> {
    const rows = await this.q.select({ count: sql<number>`count(*)::int` }).from(MEMBERSHIPS).where(eq(MEMBERSHIPS.programId, programId));
    return rows[0]?.count ?? 0;
  }

  async update(membershipId: string, patch: GovernanceMembershipPatch): Promise<GovernanceMembershipRecord | null> {
    const rows = await this.q
      .update(MEMBERSHIPS)
      .set({
        ...(patch.scopeId !== undefined ? { scopeId: patch.scopeId } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
        ...(patch.invitedBy !== undefined ? { invitedBy: patch.invitedBy } : {}),
        updatedAt: new Date(),
      })
      .where(eq(MEMBERSHIPS.id, membershipId))
      .returning();
    return rows[0] ? membershipRowToRecord(rows[0]) : null;
  }

  async deleteById(membershipId: string): Promise<void> {
    await this.q.delete(MEMBERSHIPS).where(eq(MEMBERSHIPS.id, membershipId));
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.q.delete(MEMBERSHIPS).where(and(eq(MEMBERSHIPS.programId, programId), eq(MEMBERSHIPS.scopeId, scopeId)));
  }
}
