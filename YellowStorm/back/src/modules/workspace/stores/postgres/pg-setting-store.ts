import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { escapeLike } from '@common/postgres/like';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { settingRowToRecord } from '../../persistence/postgres/pg-workspace-setting-read.adapter';
import { SETTING_STORE, type SettingStore, type SettingCreateInput, type SettingListParams, type SettingUpdatePatch } from '../setting-store';
import type { WorkspaceSettingRecord } from '../../ports/workspace-records';

const SETTINGS = schema.workspaceSettings;

@Injectable()
export class PgSettingStore implements SettingStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async create(input: SettingCreateInput): Promise<WorkspaceSettingRecord> {
    const rows = await this.q
      .insert(SETTINGS)
      .values({
        id: newObjectId(),
        name: input.name,
        description: input.description,
        tag: input.tag,
        llmModel: input.llmModel,
        isTemplate: input.isTemplate,
        isPredefined: input.isPredefined,
        createdBy: input.createdBy,
        instruction: input.instruction,
        chunks: input.chunks,
        hybridSearch: input.hybridSearch,
        ragType: input.ragType,
        maxToken: input.maxToken,
        topK: input.topK,
      })
      .returning();
    return settingRowToRecord(rows[0]);
  }

  async findById(id: string): Promise<WorkspaceSettingRecord | null> {
    const rows = await this.q.select().from(SETTINGS).where(eq(SETTINGS.id, id)).limit(1);
    return rows[0] ? settingRowToRecord(rows[0]) : null;
  }

  private async list(where: ReturnType<typeof and> | undefined, params: SettingListParams): Promise<{ items: WorkspaceSettingRecord[]; total: number }> {
    const { skip, limit, sortBy, sortOrder } = params;
    const column =
      sortBy === 'name' ? SETTINGS.name : sortBy === 'updatedAt' ? SETTINGS.updatedAt : SETTINGS.createdAt;
    const [rows, countRows] = await Promise.all([
      this.q
        .select()
        .from(SETTINGS)
        .where(where)
        .orderBy(sortOrder === 'asc' ? asc(column) : desc(column))
        .offset(skip)
        .limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(SETTINGS).where(where),
    ]);
    return { items: rows.map(settingRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async listByUser(userId: string, params: SettingListParams): Promise<{ items: WorkspaceSettingRecord[]; total: number }> {
    return this.list(this.buildFilter(eq(SETTINGS.createdBy, userId), params), params);
  }

  async listTemplates(params: SettingListParams): Promise<{ items: WorkspaceSettingRecord[]; total: number }> {
    return this.list(this.buildFilter(eq(SETTINGS.isTemplate, true), params), params);
  }

  private buildFilter(base: ReturnType<typeof eq>, params: SettingListParams) {
    const conditions = [base];
    if (params.tag) conditions.push(eq(SETTINGS.tag, params.tag));
    if (params.search) {
      const pattern = `%${escapeLike(params.search)}%`;
      conditions.push(or(ilike(SETTINGS.name, pattern), ilike(SETTINGS.description, pattern))!);
    }
    return and(...conditions);
  }

  async updateFields(id: string, patch: SettingUpdatePatch): Promise<void> {
    const values: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'tag', 'llmModel', 'isTemplate', 'instruction', 'chunks', 'hybridSearch', 'ragType', 'maxToken', 'topK'] as const) {
      if (patch[key] !== undefined) values[key] = patch[key];
    }
    if (Object.keys(values).length === 0) return;
    values.updatedAt = new Date();
    await this.q.update(SETTINGS).set(values as Partial<typeof SETTINGS.$inferInsert>).where(eq(SETTINGS.id, id));
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(SETTINGS).where(eq(SETTINGS.id, id));
  }
}
