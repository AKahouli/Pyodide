import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { AssignablePlaybookPermission } from '../interfaces/playbook-share.interface';

const sp = schema.playbookSharedPlaybooks;

type ShareRow = typeof sp.$inferSelect;

export type SharedPlaybookRecord = Omit<ShareRow, 'permission'> & { permission: AssignablePlaybookPermission };

const toShareRecord = (row: ShareRow): SharedPlaybookRecord => ({ ...row, permission: row.permission as AssignablePlaybookPermission });

/** PostgreSQL playbook.shared_playbooks repository (roadmap P5): access granted on a flow without changing its owner. */
@Injectable()
export class SharedPlaybookRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Grants `sharedWith` access to the playbook, or changes the permission (and granter) of the existing grant. */
  async upsert(playbookId: string, sharedWith: string, sharedBy: string, permission: AssignablePlaybookPermission): Promise<SharedPlaybookRecord> {
    const now = new Date();
    const [row] = await this.q
      .insert(sp)
      .values({
        id: newObjectId(),
        playbookId: normalizeObjectId(playbookId),
        sharedWith: normalizeObjectId(sharedWith),
        sharedBy: normalizeObjectId(sharedBy),
        permission,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: [sp.playbookId, sp.sharedWith], set: { permission, sharedBy: normalizeObjectId(sharedBy), updatedAt: now } })
      .returning();
    return toShareRecord(row);
  }

  /** The playbook's grants, newest first. */
  async listForPlaybook(playbookId: string): Promise<SharedPlaybookRecord[]> {
    if (!isObjectId(playbookId)) return [];
    const rows = await this.q.select().from(sp).where(eq(sp.playbookId, normalizeObjectId(playbookId))).orderBy(desc(sp.createdAt), desc(sp.id));
    return rows.map(toShareRecord);
  }

  /** The grants a user received, newest first. */
  async listSharedWith(userId: string): Promise<SharedPlaybookRecord[]> {
    if (!isObjectId(userId)) return [];
    const rows = await this.q.select().from(sp).where(eq(sp.sharedWith, normalizeObjectId(userId))).orderBy(desc(sp.createdAt), desc(sp.id));
    return rows.map(toShareRecord);
  }

  async listPlaybookIdsSharedWith(userId: string): Promise<string[]> {
    if (!isObjectId(userId)) return [];
    const rows = await this.q
      .select({ playbookId: sp.playbookId })
      .from(sp)
      .where(eq(sp.sharedWith, normalizeObjectId(userId)))
      .orderBy(desc(sp.createdAt), asc(sp.playbookId));
    return rows.map((row) => row.playbookId);
  }

  async findPermission(userId: string, playbookId: string): Promise<AssignablePlaybookPermission | null> {
    if (!isObjectId(userId) || !isObjectId(playbookId)) return null;
    const [row] = await this.q
      .select({ permission: sp.permission })
      .from(sp)
      .where(and(eq(sp.playbookId, normalizeObjectId(playbookId)), eq(sp.sharedWith, normalizeObjectId(userId))))
      .limit(1);
    return row ? (row.permission as AssignablePlaybookPermission) : null;
  }

  async updatePermission(playbookId: string, shareId: string, permission: AssignablePlaybookPermission): Promise<SharedPlaybookRecord | null> {
    if (!isObjectId(playbookId) || !isObjectId(shareId)) return null;
    const [row] = await this.q
      .update(sp)
      .set({ permission, updatedAt: new Date() })
      .where(and(eq(sp.id, normalizeObjectId(shareId)), eq(sp.playbookId, normalizeObjectId(playbookId))))
      .returning();
    return row ? toShareRecord(row) : null;
  }

  /** Removes one grant and returns it, or null when it does not belong to the playbook. */
  async delete(playbookId: string, shareId: string): Promise<SharedPlaybookRecord | null> {
    if (!isObjectId(playbookId) || !isObjectId(shareId)) return null;
    const [row] = await this.q
      .delete(sp)
      .where(and(eq(sp.id, normalizeObjectId(shareId)), eq(sp.playbookId, normalizeObjectId(playbookId))))
      .returning();
    return row ? toShareRecord(row) : null;
  }

  async deleteAllForPlaybook(playbookId: string): Promise<number> {
    if (!isObjectId(playbookId)) return 0;
    const rows = await this.q.delete(sp).where(eq(sp.playbookId, normalizeObjectId(playbookId))).returning({ id: sp.id });
    return rows.length;
  }
}
