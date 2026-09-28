import { Inject } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { EvaluationRunMode, ScenarioInput, ScenarioRecord } from '../evaluation.types';
import type { CreateScenarioData, EvaluationScenarioStore } from './evaluation-scenario.store';

type Row = typeof schema.agentEvaluationScenarios.$inferSelect;

function toRecord(row: Row): ScenarioRecord {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agentId,
    datasetId: row.datasetId,
    numRuns: row.numRuns,
    mode: row.mode as EvaluationRunMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL agent_evaluation.scenarios implementation of EvaluationScenarioStore (roadmap P6). */
export class PgEvaluationScenarioStore implements EvaluationScenarioStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(data: CreateScenarioData): Promise<ScenarioRecord> {
    const [row] = await this.q
      .insert(schema.agentEvaluationScenarios)
      .values({
        id: newObjectId(),
        name: stripNul(data.name),
        agentId: normalizeObjectId(data.agentId),
        datasetId: normalizeObjectId(data.datasetId),
        ...(data.numRuns !== undefined ? { numRuns: data.numRuns } : {}),
        ...(data.mode !== undefined ? { mode: data.mode } : {}),
      })
      .returning();
    return toRecord(row);
  }

  async findByAgent(agentId: string): Promise<ScenarioRecord[]> {
    if (!isObjectId(agentId)) return [];
    const rows = await this.q
      .select()
      .from(schema.agentEvaluationScenarios)
      .where(eq(schema.agentEvaluationScenarios.agentId, normalizeObjectId(agentId)))
      .orderBy(asc(schema.agentEvaluationScenarios.createdAt), asc(schema.agentEvaluationScenarios.id));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<ScenarioRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .select()
      .from(schema.agentEvaluationScenarios)
      .where(eq(schema.agentEvaluationScenarios.id, normalizeObjectId(id)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async update(id: string, patch: ScenarioInput): Promise<ScenarioRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.agentEvaluationScenarios)
      .set({
        ...(patch.name !== undefined ? { name: stripNul(patch.name) } : {}),
        ...(patch.agentId !== undefined ? { agentId: normalizeObjectId(patch.agentId) } : {}),
        ...(patch.datasetId !== undefined ? { datasetId: normalizeObjectId(patch.datasetId) } : {}),
        ...(patch.numRuns !== undefined ? { numRuns: patch.numRuns } : {}),
        ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.agentEvaluationScenarios.id, normalizeObjectId(id)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async deleteById(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .delete(schema.agentEvaluationScenarios)
      .where(eq(schema.agentEvaluationScenarios.id, normalizeObjectId(id)));
  }
}
