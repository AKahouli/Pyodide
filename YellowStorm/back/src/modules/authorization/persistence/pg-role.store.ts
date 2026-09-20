import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { isObjectId, newObjectId } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { escapeLike } from '@common/postgres/like';
import * as schema from '@modules/postgres/schema';
import type { RolePatch, RoleRecord, RoleStore } from './role.store';
import type { AuditLogQuery, AuditLogRecord, AuditLogStore } from './audit-log.store';

type RoleRow = typeof schema.authzRoles.$inferSelect;
type AuditRow = typeof schema.authzAuditLogs.$inferSelect;

function toRoleRecord(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: row.permissions,
    isActive: row.isActive,
    isSystem: row.isSystem,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL authz.roles implementation (plan 1A.2). */
export class PgRoleStore implements RoleStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findAll(): Promise<RoleRecord[]> {
    const rows: RoleRow[] = await this.q
      .select()
      .from(schema.authzRoles)
      .orderBy(desc(schema.authzRoles.priority), asc(schema.authzRoles.name));
    return rows.map(toRoleRecord);
  }

  async findAllActive(): Promise<RoleRecord[]> {
    const rows: RoleRow[] = await this.q
      .select()
      .from(schema.authzRoles)
      .where(eq(schema.authzRoles.isActive, true))
      .orderBy(desc(schema.authzRoles.priority), asc(schema.authzRoles.name));
    return rows.map(toRoleRecord);
  }

  async findById(id: string): Promise<RoleRecord | null> {
    if (!isObjectId(id)) return null;
    const rows: RoleRow[] = await this.q.select().from(schema.authzRoles).where(eq(schema.authzRoles.id, id)).limit(1);
    return rows.length ? toRoleRecord(rows[0]) : null;
  }

  async findByName(name: string): Promise<RoleRecord | null> {
    const rows: RoleRow[] = await this.q.select().from(schema.authzRoles).where(eq(schema.authzRoles.name, name.toLowerCase())).limit(1);
    return rows.length ? toRoleRecord(rows[0]) : null;
  }

  async create(init: { name: string; description: string; permissions: string[]; isSystem?: boolean; priority?: number; isActive?: boolean }): Promise<RoleRecord> {
    const rows: RoleRow[] = await this.q
      .insert(schema.authzRoles)
      .values({
        id: newObjectId(),
        name: init.name.toLowerCase(),
        description: init.description,
        permissions: init.permissions,
        isSystem: init.isSystem ?? false,
        priority: init.priority ?? 0,
        isActive: init.isActive ?? true,
      })
      .returning();
    return toRoleRecord(rows[0]);
  }

  async update(id: string, patch: RolePatch): Promise<RoleRecord | null> {
    if (!isObjectId(id)) return null;
    const rows: RoleRow[] = await this.q
      .update(schema.authzRoles)
      .set({ ...patch, ...(patch.name !== undefined && { name: patch.name.toLowerCase() }), updatedAt: new Date() })
      .where(eq(schema.authzRoles.id, id))
      .returning();
    return rows.length ? toRoleRecord(rows[0]) : null;
  }

  async deleteByIdAndDetach(id: string): Promise<RoleRecord | null> {
    if (!isObjectId(id)) return null;
    return withTransaction(this.db, async (tx) => {
      // Capture affected users before the junction rows cascade away.
      const affected = await tx
        .select({ userId: schema.identityUserRoles.userId })
        .from(schema.identityUserRoles)
        .where(eq(schema.identityUserRoles.roleId, id));
      const rows: RoleRow[] = await tx.delete(schema.authzRoles).where(eq(schema.authzRoles.id, id)).returning();
      if (rows.length === 0) return null;
      if (affected.length > 0) {
        await tx
          .update(schema.identityUsers)
          .set({ permissionsVersion: sql`${schema.identityUsers.permissionsVersion} + 1`, updatedAt: new Date() })
          .where(inArray(schema.identityUsers.id, affected.map((a) => a.userId)));
      }
      return toRoleRecord(rows[0]);
    });
  }

  async ensureDefaults(roles: Array<{ name: string; description: string; permissions: string[]; isSystem?: boolean; priority?: number }>): Promise<void> {
    if (roles.length === 0) return;
    await this.q
      .insert(schema.authzRoles)
      .values(
        roles.map((role) => ({
          id: newObjectId(),
          name: role.name.toLowerCase(),
          description: role.description,
          permissions: role.permissions,
          isSystem: role.isSystem ?? true,
          priority: role.priority ?? 0,
        })),
      )
      .onConflictDoNothing({ target: schema.authzRoles.name });
  }
}

function toAuditRecord(row: AuditRow): AuditLogRecord {
  return {
    id: row.id,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    action: row.action,
    targetId: row.targetId,
    targetType: row.targetType,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    status: row.status as 'success' | 'failure',
    failureReason: row.failureReason,
    createdAt: row.createdAt,
  };
}

/** PostgreSQL authz.audit_logs implementation. */
export class PgAuditLogStore implements AuditLogStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async insert(record: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<void> {
    await this.q.insert(schema.authzAuditLogs).values({
      id: newObjectId(),
      actorId: record.actorId,
      actorEmail: record.actorEmail,
      action: record.action,
      targetId: record.targetId,
      targetType: record.targetType,
      metadata: record.metadata,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      status: record.status,
      failureReason: record.failureReason,
    });
  }

  async findAll(query: AuditLogQuery): Promise<{ logs: AuditLogRecord[]; total: number; hasMore: boolean }> {
    const conditions = [];
    if (query.actorId && isObjectId(query.actorId)) conditions.push(eq(schema.authzAuditLogs.actorId, query.actorId));
    if (query.actorEmail) conditions.push(ilike(schema.authzAuditLogs.actorEmail, `%${escapeLike(query.actorEmail)}%`));
    if (query.action) conditions.push(eq(schema.authzAuditLogs.action, query.action));
    if (query.feature) conditions.push(ilike(schema.authzAuditLogs.action, `${escapeLike(query.feature)}.%`));
    if (query.targetType) conditions.push(eq(schema.authzAuditLogs.targetType, query.targetType));
    if (query.status) conditions.push(eq(schema.authzAuditLogs.status, query.status));
    if (query.startDate) conditions.push(gte(schema.authzAuditLogs.createdAt, query.startDate));
    if (query.endDate) conditions.push(lte(schema.authzAuditLogs.createdAt, query.endDate));
    const where = conditions.length ? and(...conditions) : undefined;

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;
    const [rows, totalRows] = await Promise.all([
      this.q
        .select()
        .from(schema.authzAuditLogs)
        .where(where)
        .orderBy(desc(schema.authzAuditLogs.createdAt))
        .limit(limit)
        .offset(skip),
      this.q.select({ n: sql<number>`count(*)::int` }).from(schema.authzAuditLogs).where(where),
    ]);
    const total = totalRows[0]?.n ?? 0;
    return { logs: rows.map(toAuditRecord), total, hasMore: skip + rows.length < total };
  }

  async getDistinctActions(): Promise<string[]> {
    const rows = await this.q
      .selectDistinct({ action: schema.authzAuditLogs.action })
      .from(schema.authzAuditLogs)
      .orderBy(asc(schema.authzAuditLogs.action));
    return rows.map((r) => r.action);
  }
}
