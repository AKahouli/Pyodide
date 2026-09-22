import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { shareRowToRecord } from '../../persistence/postgres/pg-workspace-share-read.adapter';
import { SHARE_STORE, type ShareStore, type ShareCreateInput, type SharePage } from '../share-store';
import type { WorkspaceShareRecord } from '../../ports/workspace-records';

const SHARES = schema.workspaceShares;

@Injectable()
export class PgShareStore implements ShareStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findById(shareId: string): Promise<WorkspaceShareRecord | null> {
    const rows = await this.q.select().from(SHARES).where(eq(SHARES.id, shareId)).limit(1);
    return rows[0] ? shareRowToRecord(rows[0]) : null;
  }

  async findForWorkspace(workspaceId: string, skip: number, limit: number): Promise<SharePage> {
    const where = eq(SHARES.workspaceId, workspaceId);
    const [rows, countRows] = await Promise.all([
      this.q.select().from(SHARES).where(where).orderBy(desc(SHARES.createdAt)).offset(skip).limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(SHARES).where(where),
    ]);
    return { items: rows.map(shareRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async findSharedWithUser(userId: string, skip: number, limit: number): Promise<SharePage> {
    const where = eq(SHARES.sharedWithUserId, userId);
    const [rows, countRows] = await Promise.all([
      this.q.select().from(SHARES).where(where).orderBy(desc(SHARES.createdAt)).offset(skip).limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(SHARES).where(where),
    ]);
    return { items: rows.map(shareRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async findOneByWorkspaceAndUser(workspaceId: string, userId: string): Promise<WorkspaceShareRecord | null> {
    const rows = await this.q
      .select()
      .from(SHARES)
      .where(and(eq(SHARES.workspaceId, workspaceId), eq(SHARES.sharedWithUserId, userId)))
      .limit(1);
    return rows[0] ? shareRowToRecord(rows[0]) : null;
  }

  async filterSharedWithUser(userId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.q
      .select({ workspaceId: SHARES.workspaceId })
      .from(SHARES)
      .where(and(inArray(SHARES.workspaceId, ids), eq(SHARES.sharedWithUserId, userId)));
    return rows.map((r) => r.workspaceId);
  }

  async create(input: ShareCreateInput): Promise<WorkspaceShareRecord> {
    const rows = await this.q
      .insert(SHARES)
      .values({
        id: newObjectId(),
        workspaceId: input.workspaceId,
        ownerId: input.ownerId,
        sharedWithUserId: input.sharedWithUserId,
        permission: input.permission,
        sharedBy: input.sharedBy,
      })
      .returning();
    return shareRowToRecord(rows[0]);
  }

  async updatePermission(shareId: string, permission: 'read' | 'readwrite'): Promise<void> {
    await this.q.update(SHARES).set({ permission, updatedAt: new Date() }).where(eq(SHARES.id, shareId));
  }

  async deleteById(shareId: string): Promise<void> {
    await this.q.delete(SHARES).where(eq(SHARES.id, shareId));
  }

  async deleteManyByWorkspace(workspaceId: string): Promise<number> {
    const rows = await this.q.delete(SHARES).where(eq(SHARES.workspaceId, workspaceId)).returning({ id: SHARES.id });
    return rows.length;
  }
}
