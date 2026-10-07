import { Inject } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { DatasetItem, DatasetRecord } from '../evaluation.types';
import type { CreateDatasetData, EvaluationDatasetStore } from './evaluation-dataset.store';

type Row = typeof schema.agentEvaluationDatasets.$inferSelect;

function toRecord(row: Row): DatasetRecord {
  return {
    id: row.id,
    name: row.name,
    items: row.items as unknown as DatasetItem[],
    createdBy: row.createdBy,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL agent_evaluation.datasets implementation of EvaluationDatasetStore (roadmap P6). */
export class PgEvaluationDatasetStore implements EvaluationDatasetStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(data: CreateDatasetData): Promise<DatasetRecord> {
    const [row] = await this.q
      .insert(schema.agentEvaluationDatasets)
      .values({
        id: newObjectId(),
        name: stripNul(data.name),
        items: stripNul(data.items) as unknown as Record<string, unknown>[],
        createdBy: normalizeObjectId(data.createdBy),
        workspaceId: data.workspaceId ? normalizeObjectId(data.workspaceId) : null,
      })
      .returning();
    return toRecord(row);
  }

  async findByCreator(userId: string): Promise<DatasetRecord[]> {
    if (!isObjectId(userId)) return [];
    const rows = await this.q
      .select()
      .from(schema.agentEvaluationDatasets)
      .where(eq(schema.agentEvaluationDatasets.createdBy, normalizeObjectId(userId)))
      .orderBy(asc(schema.agentEvaluationDatasets.createdAt), asc(schema.agentEvaluationDatasets.id));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<DatasetRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .select()
      .from(schema.agentEvaluationDatasets)
      .where(eq(schema.agentEvaluationDatasets.id, normalizeObjectId(id)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async deleteById(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .delete(schema.agentEvaluationDatasets)
      .where(eq(schema.agentEvaluationDatasets.id, normalizeObjectId(id)));
  }
}
