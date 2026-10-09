import { Inject } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  EvaluationIteration,
  EvaluationRecord,
  EvaluationRunMode,
  EvaluationRunStatus,
} from '../evaluation.types';
import type { CreateEvaluationData, EvaluationRunStore } from './evaluation-run.store';

type Row = typeof schema.agentEvaluationEvaluations.$inferSelect;

function toRecord(row: Row): EvaluationRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    scenarioName: row.scenarioName,
    ...(row.datasetId ? { datasetId: row.datasetId } : {}),
    mode: row.mode as EvaluationRunMode,
    results: row.results as unknown as EvaluationIteration[],
    numRuns: row.numRuns,
    completedRuns: row.completedRuns,
    status: row.status as EvaluationRunStatus,
    createdBy: row.createdBy,
    ...(row.error != null ? { error: row.error } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL agent_evaluation.evaluations implementation of EvaluationRunStore (roadmap P6). */
export class PgEvaluationRunStore implements EvaluationRunStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(data: CreateEvaluationData): Promise<EvaluationRecord> {
    const [row] = await this.q
      .insert(schema.agentEvaluationEvaluations)
      .values({
        id: newObjectId(),
        agentId: normalizeObjectId(data.agentId),
        scenarioName: stripNul(data.scenarioName),
        datasetId: normalizeObjectId(data.datasetId),
        mode: data.mode,
        status: 'processing',
        numRuns: data.numRuns,
        completedRuns: 0,
        createdBy: normalizeObjectId(data.createdBy),
      })
      .returning();
    return toRecord(row);
  }

  /** Null when the run does not exist OR was created by someone else — the two are indistinguishable. */
  async findById(id: string, userId: string): Promise<EvaluationRecord | null> {
    if (!isObjectId(id) || !isObjectId(userId)) return null;
    const [row] = await this.q
      .select()
      .from(schema.agentEvaluationEvaluations)
      .where(and(eq(schema.agentEvaluationEvaluations.id, normalizeObjectId(id)),
        eq(schema.agentEvaluationEvaluations.createdBy, normalizeObjectId(userId))))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** The creator's own runs for an agent, newest first — another manager's runs stay hidden. */
  async findByAgent(agentId: string, userId: string): Promise<EvaluationRecord[]> {
    if (!isObjectId(agentId) || !isObjectId(userId)) return [];
    const rows = await this.q
      .select()
      .from(schema.agentEvaluationEvaluations)
      .where(and(eq(schema.agentEvaluationEvaluations.agentId, normalizeObjectId(agentId)),
        eq(schema.agentEvaluationEvaluations.createdBy, normalizeObjectId(userId))))
      .orderBy(desc(schema.agentEvaluationEvaluations.createdAt), desc(schema.agentEvaluationEvaluations.id));
    return rows.map(toRecord);
  }

  async appendRunResults(id: string, userId: string, results: EvaluationIteration[]): Promise<void> {
    if (!isObjectId(id) || !isObjectId(userId)) return;
    const t = schema.agentEvaluationEvaluations;
    await this.q
      .update(t)
      .set({
        // One statement: two concurrent runs of the same evaluation cannot lose each other's iterations.
        results: sql`${t.results} || ${JSON.stringify(stripNul(results))}::jsonb`,
        completedRuns: sql`${t.completedRuns} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(t.id, normalizeObjectId(id)), eq(t.createdBy, normalizeObjectId(userId))));
  }

  async finalize(
    id: string,
    userId: string,
    status: Exclude<EvaluationRunStatus, 'processing'>,
    error?: string,
  ): Promise<EvaluationRecord | null> {
    if (!isObjectId(id) || !isObjectId(userId)) return null;
    const [row] = await this.q
      .update(schema.agentEvaluationEvaluations)
      .set({
        status,
        // An absent error leaves the stored one untouched, as the Mongo `$set` did.
        ...(error ? { error: stripNul(error) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.agentEvaluationEvaluations.id, normalizeObjectId(id)),
        eq(schema.agentEvaluationEvaluations.createdBy, normalizeObjectId(userId))))
      .returning();
    return row ? toRecord(row) : null;
  }

  async deleteById(id: string, userId: string): Promise<void> {
    if (!isObjectId(id) || !isObjectId(userId)) return;
    await this.q
      .delete(schema.agentEvaluationEvaluations)
      .where(and(eq(schema.agentEvaluationEvaluations.id, normalizeObjectId(id)),
        eq(schema.agentEvaluationEvaluations.createdBy, normalizeObjectId(userId))));
  }
}
