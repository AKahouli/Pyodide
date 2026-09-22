import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { resolveQueryable } from '@common/postgres/transaction';
import { WORKSPACE_SHARE_READ_PORT, type WorkspaceShareReadPort } from '../../ports/workspace-share-read.port';
import type { WorkspaceShareRecord } from '../../ports/workspace-records';

const SHARES = schema.workspaceShares;

export function shareRowToRecord(row: typeof SHARES.$inferSelect): WorkspaceShareRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerId: row.ownerId,
    sharedWithUserId: row.sharedWithUserId,
    permission: row.permission as 'read' | 'readwrite',
    sharedBy: row.sharedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgWorkspaceShareReadAdapter implements WorkspaceShareReadPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findForUser(userId: string): Promise<WorkspaceShareRecord[]> {
    const rows = await this.q
      .select()
      .from(SHARES)
      .where(eq(SHARES.sharedWithUserId, userId))
      .orderBy(desc(SHARES.createdAt));
    return rows.map(shareRowToRecord);
  }

  async findForWorkspace(workspaceId: string): Promise<WorkspaceShareRecord[]> {
    const rows = await this.q
      .select()
      .from(SHARES)
      .where(eq(SHARES.workspaceId, workspaceId))
      .orderBy(desc(SHARES.createdAt));
    return rows.map(shareRowToRecord);
  }

  async permissionFor(workspaceId: string, userId: string): Promise<'read' | 'readwrite' | null> {
    const rows = await this.q
      .select({ permission: SHARES.permission })
      .from(SHARES)
      .where(and(eq(SHARES.workspaceId, workspaceId), eq(SHARES.sharedWithUserId, userId)))
      .limit(1);
    return (rows[0]?.permission as 'read' | 'readwrite' | undefined) ?? null;
  }
}
