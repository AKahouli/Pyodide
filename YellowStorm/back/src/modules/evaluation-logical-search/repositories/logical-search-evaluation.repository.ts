import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../postgres/postgres.constants';
import { evaluationRuns, evaluationResults } from '../../postgres/schema';
import type { EvaluationQueryResult } from '../services/evaluation-metrics';

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
  modelId?: string | null;
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
      .insert(evaluationRuns)
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
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, id))
      .limit(1);
    return row ?? null;
  }

  async listByOwner(ownerId: string, limit = 50) {
    return this.db
      .select()
      .from(evaluationRuns)
      .where(eq(evaluationRuns.ownerId, ownerId))
      .orderBy(desc(evaluationRuns.createdAt))
      .limit(limit);
  }

  async applyPrepare(input: LinkExecutionInput) {
    const [row] = await this.db
      .update(evaluationRuns)
      .set({
        agentId: input.agentId,
        flowId: input.flowId,
        workspaceId: input.workspaceId,
        executionId: input.executionId,
        modelId: input.modelId ?? null,
        answerNodeId: input.answerNodeId,
        status: input.status,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(evaluationRuns.id, input.id))
      .returning();
    return row ?? null;
  }

  async applyRunStart(id: string) {
    const [row] = await this.db
      .update(evaluationRuns)
      .set({ status: 'running', error: null, updatedAt: new Date() })
      .where(eq(evaluationRuns.id, id))
      .returning();
    return row ?? null;
  }

  async listStaleRunning(maxAgeMs: number) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    return this.db
      .select()
      .from(evaluationRuns)
      .where(and(eq(evaluationRuns.status, 'running'), lt(evaluationRuns.updatedAt, cutoff)))
      .limit(50);
  }

  async applyRunProgress(id: string) {
    const [row] = await this.db
      .update(evaluationRuns)
      .set({ updatedAt: new Date() })
      .where(eq(evaluationRuns.id, id))
      .returning();
    return row ?? null;
  }

  async applyRunComplete(id: string, input: { summary: unknown; error?: string | null }) {
    const [row] = await this.db
      .update(evaluationRuns)
      .set({
        status: input.error ? 'failed' : 'completed',
        summary: input.summary,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(evaluationRuns.id, id))
      .returning();
    return row ?? null;
  }

  async applyResult(evaluationId: string, result: EvaluationQueryResult) {
    const values = {
      evaluationId,
      queryId: result.query_id,
      query: result.query,
      expectedAnswer: result.expected_answer,
      generatedAnswer: result.generated_answer,
      status: result.status === 'completed' ? 'completed' : 'failed',
      durationMs: Number.isFinite(result.duration_ms) ? Math.round(result.duration_ms) : null,
      targetDurationMs:
        result.target_duration_ms !== undefined && Number.isFinite(result.target_duration_ms)
          ? Math.round(result.target_duration_ms)
          : null,
      judgeDurationMs:
        result.judge_duration_ms !== undefined && Number.isFinite(result.judge_duration_ms)
          ? Math.round(result.judge_duration_ms)
          : null,
      judgeScore: result.judge_score ?? null,
      judgeFaithfulnessScore: result.judge_faithfulness_score ?? null,
      judgeReasoning: result.judge_reasoning ?? null,
      retrievedFiles: result.retrieved_files,
      toolCalls: result.tool_calls ?? null,
      tokenUsage: result.token_usage ?? null,
      error: result.error ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.db
      .insert(evaluationResults)
      .values(values)
      .onConflictDoUpdate({
        target: [evaluationResults.evaluationId, evaluationResults.queryId],
        set: { ...values, id: evaluationResults.id, createdAt: evaluationResults.createdAt },
      });
  }
}
