import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../postgres/postgres.constants';
import { logicalSearchEvaluations } from '../../postgres/schema';

export interface CreateEvaluationInput {
  ownerId: string;
  name: string;
  sourceFileName: string;
  queryCount: number;
  queries: { queries: unknown[] };
}

export interface LinkExecutionInput {
  id: string;
  agentId: string | null;
  flowId: string | null;
  workspaceId: string | null;
  executionId: string | null;
  answerNodeId: string | null;
  status: 'prepared' | 'failed';
  error?: string | null;
}

@Injectable()
export class LogicalSearchEvaluationRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof import('../../postgres/schema')>,
  ) {}

  async create(input: CreateEvaluationInput) {
    const [row] = await this.db
      .insert(logicalSearchEvaluations)
      .values({
        ownerId: input.ownerId,
        name: input.name,
        sourceFileName: input.sourceFileName,
        queryCount: input.queryCount,
        queries: input.queries,
        status: 'dataset_ready',
      })
      .returning();
    return row;
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(logicalSearchEvaluations)
      .where(eq(logicalSearchEvaluations.id, id))
      .limit(1);
    return row ?? null;
  }

  async listByOwner(ownerId: string, limit = 50) {
    return this.db
      .select()
      .from(logicalSearchEvaluations)
      .where(eq(logicalSearchEvaluations.ownerId, ownerId))
      .orderBy(desc(logicalSearchEvaluations.createdAt))
      .limit(limit);
  }

  async applyPrepare(input: LinkExecutionInput) {
    const [row] = await this.db
      .update(logicalSearchEvaluations)
      .set({
        agentId: input.agentId,
        flowId: input.flowId,
        workspaceId: input.workspaceId,
        executionId: input.executionId,
        answerNodeId: input.answerNodeId,
        status: input.status,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(logicalSearchEvaluations.id, input.id))
      .returning();
    return row ?? null;
  }

  async applyRunStart(id: string) {
    const [row] = await this.db
      .update(logicalSearchEvaluations)
      .set({ status: 'running', error: null, updatedAt: new Date() })
      .where(eq(logicalSearchEvaluations.id, id))
      .returning();
    return row ?? null;
  }

  async listStaleRunning(maxAgeMs: number) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    return this.db
      .select()
      .from(logicalSearchEvaluations)
      .where(and(eq(logicalSearchEvaluations.status, 'running'), lt(logicalSearchEvaluations.updatedAt, cutoff)))
      .limit(50);
  }

  async applyRunProgress(id: string) {
    const [row] = await this.db
      .update(logicalSearchEvaluations)
      .set({ updatedAt: new Date() })
      .where(eq(logicalSearchEvaluations.id, id))
      .returning();
    return row ?? null;
  }

  async applyRunComplete(id: string, input: { summary: unknown; error?: string | null }) {
    const [row] = await this.db
      .update(logicalSearchEvaluations)
      .set({
        status: input.error ? 'failed' : 'completed',
        summary: input.summary,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(logicalSearchEvaluations.id, id))
      .returning();
    return row ?? null;
  }
}
