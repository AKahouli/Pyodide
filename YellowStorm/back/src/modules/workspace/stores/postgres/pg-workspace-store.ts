import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { escapeLike } from '@common/postgres/like';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { workspaceRowToRecord } from '../../persistence/postgres/pg-workspace-read.adapter';
import { WORKSPACE_STORE, type WorkspaceStore, type WorkspaceCreateInput, type WorkspaceListParams, type WorkspaceListPublicParams, type WorkspaceUpdatePatch, type WorkspaceCounterDelta } from '../workspace-store';
import type { WorkspaceRecord } from '../../ports/workspace-records';

const WORKSPACES = schema.workspaces;

function orderClause(col: string | undefined, direction: 'asc' | 'desc'): SQL {
  const column =
    col === 'name' ? WORKSPACES.name : col === 'alias' ? WORKSPACES.alias : col === 'updatedAt' ? WORKSPACES.updatedAt : WORKSPACES.createdAt;
  return direction === 'asc' ? asc(column) : desc(column);
}

@Injectable()
export class PgWorkspaceStore implements WorkspaceStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  // ponytail: the alias→storagePrefix backfill is a Mongo-repair shim; PG rows
  // get storage_prefix from the migration (NOT NULL). No-op forever.
  async backfillStoragePrefixFromAlias(): Promise<number> {
    return 0;
  }

  async countNonSystemByOwner(userId: string): Promise<number> {
    const rows = await this.q
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(WORKSPACES)
      .where(and(eq(WORKSPACES.createdBy, userId), ne(WORKSPACES.isSystem, true)));
    return rows[0]?.n ?? 0;
  }

  async findByName(ownerId: string, name: string, excludeWorkspaceId?: string): Promise<WorkspaceRecord | null> {
    const conditions = [eq(WORKSPACES.createdBy, ownerId), eq(WORKSPACES.name, name)];
    if (excludeWorkspaceId) conditions.push(ne(WORKSPACES.id, excludeWorkspaceId));
    const rows = await this.q.select().from(WORKSPACES).where(and(...conditions)).limit(1);
    return rows[0] ? workspaceRowToRecord(rows[0]) : null;
  }

  async findByOwnerAndAlias(userId: string, alias: string, excludeWorkspaceId?: string): Promise<WorkspaceRecord | null> {
    const conditions = [eq(WORKSPACES.createdBy, userId), eq(WORKSPACES.alias, alias)];
    if (excludeWorkspaceId) conditions.push(ne(WORKSPACES.id, excludeWorkspaceId));
    const rows = await this.q.select().from(WORKSPACES).where(and(...conditions)).limit(1);
    return rows[0] ? workspaceRowToRecord(rows[0]) : null;
  }

  async findByOwnerPersonal(userId: string): Promise<WorkspaceRecord | null> {
    const rows = await this.q
      .select()
      .from(WORKSPACES)
      .where(and(eq(WORKSPACES.createdBy, userId), eq(WORKSPACES.isPersonal, true)))
      .limit(1);
    return rows[0] ? workspaceRowToRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<WorkspaceRecord | null> {
    const rows = await this.q.select().from(WORKSPACES).where(eq(WORKSPACES.id, id)).limit(1);
    return rows[0] ? workspaceRowToRecord(rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, WorkspaceRecord>> {
    const map = new Map<string, WorkspaceRecord>();
    if (ids.length === 0) return map;
    const rows = await this.q.select().from(WORKSPACES).where(inArray(WORKSPACES.id, ids));
    for (const row of rows) {
      const record = workspaceRowToRecord(row);
      map.set(record.id, record);
    }
    return map;
  }

  async filterOwned(ids: string[], userId: string): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.q
      .select({ id: WORKSPACES.id })
      .from(WORKSPACES)
      .where(and(inArray(WORKSPACES.id, ids), eq(WORKSPACES.createdBy, userId)));
    return rows.map((r) => r.id);
  }

  async filterPublic(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.q
      .select({ id: WORKSPACES.id })
      .from(WORKSPACES)
      .where(and(inArray(WORKSPACES.id, ids), eq(WORKSPACES.isPublic, true)));
    return rows.map((r) => r.id);
  }

  async findIdsByOwner(userId: string): Promise<string[]> {
    const rows = await this.q
      .select({ id: WORKSPACES.id })
      .from(WORKSPACES)
      .where(and(eq(WORKSPACES.createdBy, userId), ne(WORKSPACES.isSystem, true)));
    return rows.map((r) => r.id);
  }

  async listByUser(userId: string, params: WorkspaceListParams): Promise<{ items: WorkspaceRecord[]; total: number }> {
    const { search, skip, limit, sortBy, sortOrder } = params;
    const conditions = [eq(WORKSPACES.createdBy, userId), ne(WORKSPACES.isSystem, true)];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(or(ilike(WORKSPACES.name, pattern), ilike(WORKSPACES.description, pattern))!);
    }
    const where = and(...conditions);
    const [rows, countRows] = await Promise.all([
      this.q
        .select()
        .from(WORKSPACES)
        .where(where)
        .orderBy(desc(WORKSPACES.isPersonal), orderClause(sortBy, sortOrder))
        .offset(skip)
        .limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(WORKSPACES).where(where),
    ]);
    return { items: rows.map(workspaceRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async listPublic(userId: string, params: WorkspaceListPublicParams): Promise<{ items: WorkspaceRecord[]; total: number }> {
    const { search, skip, limit } = params;
    const conditions = [eq(WORKSPACES.isPublic, true), ne(WORKSPACES.isSystem, true), ne(WORKSPACES.createdBy, userId)];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(or(ilike(WORKSPACES.name, pattern), ilike(WORKSPACES.description, pattern))!);
    }
    const where = and(...conditions);
    const [rows, countRows] = await Promise.all([
      this.q.select().from(WORKSPACES).where(where).orderBy(desc(WORKSPACES.updatedAt)).offset(skip).limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(WORKSPACES).where(where),
    ]);
    return { items: rows.map(workspaceRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async create(input: WorkspaceCreateInput): Promise<WorkspaceRecord> {
    const rows = await this.q
      .insert(WORKSPACES)
      .values({
        id: newObjectId(),
        name: input.name,
        alias: input.alias,
        storagePrefix: input.storagePrefix,
        description: input.description,
        createdBy: input.createdBy,
        settingsId: input.settingsId,
        documentCount: input.documentCount ?? 0,
        usedStorage: input.usedStorage ?? 0,
        allocatedStorage: input.allocatedStorage,
        isSystem: input.isSystem ?? false,
        isPersonal: input.isPersonal ?? false,
        conversationId: input.conversationId || null,
      })
      .returning();
    return workspaceRowToRecord(rows[0]);
  }

  async updateFields(id: string, patch: WorkspaceUpdatePatch): Promise<void> {
    const values: Partial<typeof WORKSPACES.$inferInsert> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.alias !== undefined) values.alias = patch.alias;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.settingsId !== undefined) values.settingsId = patch.settingsId;
    if (patch.isPublic !== undefined) values.isPublic = patch.isPublic;
    if (Object.keys(values).length === 0) return;
    values.updatedAt = new Date();
    await this.q.update(WORKSPACES).set(values).where(eq(WORKSPACES.id, id));
  }

  /** Stored counters are copied from Mongo and incremented, never recomputed. */
  async incrementCounters(id: string, delta: WorkspaceCounterDelta): Promise<void> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (delta.usedStorage !== undefined) values.usedStorage = sql`GREATEST(${WORKSPACES.usedStorage} + ${delta.usedStorage}, 0)`;
    if (delta.documentCount !== undefined) values.documentCount = sql`GREATEST(${WORKSPACES.documentCount} + ${delta.documentCount}, 0)`;
    if (delta.shareCount !== undefined) values.shareCount = sql`GREATEST(${WORKSPACES.shareCount} + ${delta.shareCount}, 0)`;
    if (Object.keys(values).length === 1) return;
    await this.q.update(WORKSPACES).set(values).where(eq(WORKSPACES.id, id));
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(WORKSPACES).where(eq(WORKSPACES.id, id));
  }

  async findSystemWorkspace(userId: string, conversationId: string): Promise<WorkspaceRecord | null> {
    const rows = await this.q
      .select()
      .from(WORKSPACES)
      .where(
        and(
          eq(WORKSPACES.name, `system-${conversationId}`),
          eq(WORKSPACES.createdBy, userId),
          eq(WORKSPACES.isSystem, true),
        ),
      )
      .limit(1);
    return rows[0] ? workspaceRowToRecord(rows[0]) : null;
  }

  async deleteSystemWorkspace(id: string): Promise<void> {
    await this.q.delete(WORKSPACES).where(and(eq(WORKSPACES.id, id), eq(WORKSPACES.isSystem, true)));
  }
}
