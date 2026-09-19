import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { resolveQueryable } from '@common/postgres/transaction';
import { WORKSPACE_READ_PORT, type WorkspaceReadPort } from '../../ports/workspace-read.port';
import type { WorkspaceRecord } from '../../ports/workspace-records';

const WORKSPACES = schema.workspaces;

export function workspaceRowToRecord(row: typeof WORKSPACES.$inferSelect): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    alias: row.alias,
    storagePrefix: row.storagePrefix,
    description: row.description ?? undefined,
    createdBy: row.createdBy,
    settingsId: row.settingsId ?? undefined,
    documentCount: row.documentCount,
    usedStorage: row.usedStorage,
    allocatedStorage: row.allocatedStorage,
    isSystem: row.isSystem,
    isPersonal: row.isPersonal,
    shareCount: row.shareCount,
    isPublic: row.isPublic,
    conversationId: row.conversationId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgWorkspaceReadAdapter implements WorkspaceReadPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
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

  async exists(id: string): Promise<boolean> {
    const rows = await this.q.select({ id: WORKSPACES.id }).from(WORKSPACES).where(eq(WORKSPACES.id, id)).limit(1);
    return rows.length > 0;
  }
}
