import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { resolveQueryable } from '@common/postgres/transaction';
import { WORKSPACE_SETTING_READ_PORT, type WorkspaceSettingReadPort } from '../../ports/workspace-setting-read.port';
import type { WorkspaceSettingRecord } from '../../ports/workspace-records';

const SETTINGS = schema.workspaceSettings;

export function settingRowToRecord(row: typeof SETTINGS.$inferSelect): WorkspaceSettingRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    tag: row.tag ?? undefined,
    llmModel: row.llmModel ?? undefined,
    isTemplate: row.isTemplate,
    isPredefined: row.isPredefined,
    createdBy: row.createdBy,
    instruction: row.instruction ?? undefined,
    chunks: row.chunks,
    hybridSearch: row.hybridSearch,
    ragType: row.ragType,
    maxToken: row.maxToken,
    topK: row.topK,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgWorkspaceSettingReadAdapter implements WorkspaceSettingReadPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<WorkspaceSettingRecord | null> {
    const rows = await this.q.select().from(SETTINGS).where(eq(SETTINGS.id, id)).limit(1);
    return rows[0] ? settingRowToRecord(rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, WorkspaceSettingRecord>> {
    const map = new Map<string, WorkspaceSettingRecord>();
    if (ids.length === 0) return map;
    const rows = await this.q.select().from(SETTINGS).where(inArray(SETTINGS.id, ids));
    for (const row of rows) {
      const record = settingRowToRecord(row);
      map.set(record.id, record);
    }
    return map;
  }
}
