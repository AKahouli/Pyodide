import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../postgres/postgres.constants';
import {
  evaluationRuns,
  evaluationResults,
  agents,
  agentConnectors,
  integrationsConnectors,
} from '../../postgres/schema';
import type { EvaluationQueryResult } from '../services/evaluation-metrics';

export type EvaluationListScope = 'runs' | 'benchmarks';

export interface CreateEvaluationInput {
  ownerId: string;
  name: string;
  sourceFileName: string;
  queryCount: number;
  queries: { queries: unknown[] };
}

export interface LinkExecutionInput {  id: string;
  agentId: string | null;
  flowId: string | null;
  workspaceId: string | null;
  executionId: string | null;
  modelId?: string | null;
  answerNodeId: string | null;
  status: 'prepared' | 'failed';
  error?: string | null;
  prepared?: unknown;
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

  private scopeFilter(ownerId: string, scope?: EvaluationListScope) {
    const owner = eq(evaluationRuns.ownerId, ownerId);
    if (scope === 'runs') return and(owner, ne(evaluationRuns.status, 'dataset_ready'));
    if (scope === 'benchmarks') return and(owner, eq(evaluationRuns.status, 'dataset_ready'));
    return owner;
  }

  async listByOwner(
    ownerId: string,
    opts: { limit?: number; offset?: number; scope?: EvaluationListScope } = {},
  ) {
    return this.db
      .select()
      .from(evaluationRuns)
      .where(this.scopeFilter(ownerId, opts.scope))
      .orderBy(desc(evaluationRuns.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
  }

  async countByOwner(ownerId: string, scope?: EvaluationListScope) {
    const [row] = await this.db
      .select({ value: count() })
      .from(evaluationRuns)
      .where(this.scopeFilter(ownerId, scope));
    return row?.value ?? 0;
  }

  async deleteById(id: string) {
    await this.db.delete(evaluationRuns).where(eq(evaluationRuns.id, id));
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
        ...(input.prepared !== undefined ? { prepared: input.prepared } : {}),
      })
      .where(eq(evaluationRuns.id, input.id))
      .returning();
    return row ?? null;
  }

  async applyRunStart(id: string) {
    const [row] = await this.db
      .update(evaluationRuns)
      .set({ status: 'running', error: null, progress: null, updatedAt: new Date() })
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

  async applyProgress(id: string, progress: unknown) {
    const [row] = await this.db
      .update(evaluationRuns)
      .set({ progress, updatedAt: new Date() })
      .where(eq(evaluationRuns.id, id))
      .returning();
    return row ?? null;
  }

  async applyRunComplete(id: string, input: { summary: unknown; error?: string | null }) {    const [row] = await this.db
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

  /** Agent names/models + connector names bound to the run's target agent. */
  async findRunMetadata(input: { agentId: string | null; evaluatorAgentId: string | null }) {
    const agentIds = [input.agentId, input.evaluatorAgentId].filter((id): id is string => Boolean(id));
    const agentRows = agentIds.length > 0
      ? await this.db
          .select({ id: agents.id, name: agents.name, model: agents.llmModel, temperature: agents.temperature })
          .from(agents)
          .where(inArray(agents.id, agentIds))
      : [];
    const connectorRows = input.agentId
      ? await this.db
          .select({ name: integrationsConnectors.name })
          .from(agentConnectors)
          .innerJoin(integrationsConnectors, eq(agentConnectors.connectorId, integrationsConnectors.id))
          .where(eq(agentConnectors.agentId, input.agentId))
      : [];
    return { agents: agentRows, connectors: connectorRows.map((row) => row.name) };
  }

  async applyNarrative(id: string, narrative: unknown) {    const [row] = await this.db
      .update(evaluationRuns)
      .set({ narrative, updatedAt: new Date() })
      .where(eq(evaluationRuns.id, id))
      .returning();
    return row ?? null;
  }

  /** Full stored result payloads for a run, ordered by query id. */
  async listResults(evaluationId: string): Promise<EvaluationQueryResult[]> {
    const rows = await this.db
      .select({ payload: evaluationResults.payload })
      .from(evaluationResults)
      .where(eq(evaluationResults.evaluationId, evaluationId))
      .orderBy(evaluationResults.queryId);
    return rows
      .map((row) => row.payload)
      .filter((payload): payload is EvaluationQueryResult => payload !== null && typeof payload === 'object');
  }

  async applyResult(evaluationId: string, result: EvaluationQueryResult) {
    const tokenInt = (value: number | undefined): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
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
      payload: result,
      tokenUsage: result.token_usage ?? null,
      targetPromptTokens: tokenInt(result.target_token_usage?.prompt_tokens),
      targetCompletionTokens: tokenInt(result.target_token_usage?.completion_tokens),
      targetTotalTokens: tokenInt(result.target_token_usage?.total_tokens),
      judgePromptTokens: tokenInt(result.judge_token_usage?.prompt_tokens),
      judgeCompletionTokens: tokenInt(result.judge_token_usage?.completion_tokens),
      judgeTotalTokens: tokenInt(result.judge_token_usage?.total_tokens),
      globalTotalTokens: tokenInt(result.token_usage?.total_tokens),
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
