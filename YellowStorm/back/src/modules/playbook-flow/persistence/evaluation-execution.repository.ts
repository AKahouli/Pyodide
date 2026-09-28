import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isForeignKeyViolation, isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const e = schema.playbookEvaluationExecutions;
type EvaluationRow = typeof e.$inferSelect;

export type EvaluationExecutionMode = 'semantic' | 'reference' | 'hybrid';
export type EvaluationExecutionStatus = 'running' | 'completed' | 'failed';
export type EvaluationExecutionVerdict = 'pass' | 'warning' | 'fail';

export interface FlowEvaluationFinding {
  severity: 'info' | 'warning' | 'error' | string;
  category: 'semantic' | 'reference' | 'artifact' | 'format' | 'evidence' | 'execution' | string;
  sourceTaskId?: string;
  message: string;
}

export interface FlowEvaluationMetrics {
  connectedInputCount?: number;
  artifactCount?: number;
  completedUpstreamSteps?: number;
  failedUpstreamSteps?: number;
  totalDurationMs?: number;
}

/**
 * One playbook.evaluation_executions row: an evaluation of one task of a run. Like the Mongo document,
 * a field that was never set has no key (the nullable columns are left out when null).
 */
export interface FlowEvaluationExecutionRecord {
  id: string;
  flowId: string;
  executionId: string;
  taskId: string;
  iteration: number;
  taskTitle: string;
  baselineId?: string;
  mode: EvaluationExecutionMode;
  status: EvaluationExecutionStatus;
  score?: number;
  verdict?: EvaluationExecutionVerdict;
  semanticScore?: number;
  referenceScore?: number;
  artifactScore?: number;
  formatScore?: number;
  evidenceScore?: number;
  executionHealthScore?: number;
  expectation: string;
  rubricVersion: string;
  judgeModel?: string;
  summary?: string;
  findings: FlowEvaluationFinding[];
  metrics: FlowEvaluationMetrics;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewEvaluationExecution {
  flowId: string;
  executionId: string;
  taskId: string;
  iteration: number;
  taskTitle: string;
  mode: string;
  status: string;
  score?: number;
  verdict?: string;
  summary?: string;
  findings?: FlowEvaluationFinding[];
}

/** The FlowEvaluationMetrics subdocument defaults Mongoose applied to the `{}` default. */
const DEFAULT_METRICS: FlowEvaluationMetrics = { connectedInputCount: 0, artifactCount: 0, completedUpstreamSteps: 0, failedUpstreamSteps: 0 };

const OPTIONAL_COLUMNS = [
  'baselineId', 'score', 'verdict', 'semanticScore', 'referenceScore', 'artifactScore', 'formatScore', 'evidenceScore', 'executionHealthScore',
  'judgeModel', 'summary', 'startedAt', 'completedAt', 'error',
] as const;

export function toEvaluationExecutionRecord(row: EvaluationRow): FlowEvaluationExecutionRecord {
  const record: Record<string, unknown> = { ...row };
  for (const key of OPTIONAL_COLUMNS) {
    if (record[key] === null) delete record[key];
  }
  record.findings = row.findings ?? [];
  record.metrics = row.metrics ?? {};
  return record as unknown as FlowEvaluationExecutionRecord;
}

/** A soft reference: kept as given, lower-cased when it is an ObjectId. */
function softRef(value: string): string {
  return isObjectId(value) ? normalizeObjectId(value) : value;
}

/** PostgreSQL playbook.evaluation_executions repository (roadmap P5). `execution_id` is a soft reference. */
@Injectable()
export class EvaluationExecutionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Records an evaluation with the schema defaults. Null when the flow does not exist. */
  async create(input: NewEvaluationExecution): Promise<FlowEvaluationExecutionRecord | null> {
    if (!isObjectId(input.flowId)) return null;
    try {
      const [row] = await this.q
        .insert(e)
        .values({
          id: newObjectId(),
          flowId: normalizeObjectId(input.flowId),
          executionId: softRef(input.executionId),
          taskId: input.taskId,
          iteration: Number.isFinite(input.iteration) ? Math.trunc(input.iteration) : 0,
          taskTitle: stripNul(input.taskTitle),
          mode: input.mode,
          status: input.status,
          score: input.score ?? null,
          verdict: input.verdict ?? null,
          summary: input.summary == null ? null : stripNul(input.summary),
          findings: stripNul(input.findings ?? []) as unknown as Record<string, unknown>[],
          metrics: { ...DEFAULT_METRICS },
          startedAt: new Date(),
        })
        .returning();
      return toEvaluationExecutionRecord(row);
    } catch (err) {
      if (isForeignKeyViolation(err)) return null;
      throw err;
    }
  }

  /** A flow's evaluations (optionally of one task), newest first. */
  async listByFlow(flowId: string, options: { taskId?: string; limit: number }): Promise<FlowEvaluationExecutionRecord[]> {
    if (!isObjectId(flowId)) return [];
    const rows = await this.q
      .select()
      .from(e)
      .where(and(eq(e.flowId, normalizeObjectId(flowId)), options.taskId ? eq(e.taskId, options.taskId) : undefined))
      .orderBy(desc(e.createdAt), desc(e.id))
      .limit(Math.max(0, Math.trunc(options.limit)));
    return rows.map(toEvaluationExecutionRecord);
  }

  /** The evaluations of one run of the flow, by iteration. */
  async listForExecution(flowId: string, executionId: string): Promise<FlowEvaluationExecutionRecord[]> {
    if (!isObjectId(flowId)) return [];
    const rows = await this.q
      .select()
      .from(e)
      .where(and(eq(e.flowId, normalizeObjectId(flowId)), eq(e.executionId, softRef(executionId))))
      .orderBy(asc(e.iteration), asc(e.createdAt), asc(e.id));
    return rows.map(toEvaluationExecutionRecord);
  }

  /** The newest evaluation of a task in a run. */
  async findLatestForTask(executionId: string, taskId: string): Promise<FlowEvaluationExecutionRecord | null> {
    const [row] = await this.q
      .select()
      .from(e)
      .where(and(eq(e.executionId, softRef(executionId)), eq(e.taskId, taskId)))
      .orderBy(desc(e.createdAt), desc(e.id))
      .limit(1);
    return row ? toEvaluationExecutionRecord(row) : null;
  }
}
