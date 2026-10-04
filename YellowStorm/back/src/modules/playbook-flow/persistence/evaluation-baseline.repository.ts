import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isForeignKeyViolation, isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const b = schema.playbookEvaluationBaselines;
type BaselineRow = typeof b.$inferSelect;

export type EvaluationBaselineSourceMode = 'selected_execution' | 'current_inputs';

export interface FlowEvaluationBaselineArtifactSnapshot {
  id?: string;
  kind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard' | string;
  name?: string;
  mimeType?: string;
  uri?: string;
  textPreview?: string;
  metadata?: Record<string, unknown>;
}

export interface FlowEvaluationBaselineInputSnapshot {
  sourceTaskId: string;
  sourceOutputPortId?: string;
  targetInputPortId?: string;
  output?: string;
  artifacts: FlowEvaluationBaselineArtifactSnapshot[];
}

/** One playbook.evaluation_baselines row: the reference a task's evaluations compare against. */
export interface FlowEvaluationBaselineRecord {
  id: string;
  flowId: string;
  taskId: string;
  iteration: number;
  sourceExecutionId: string;
  sourceMode: EvaluationBaselineSourceMode;
  inputSnapshots: FlowEvaluationBaselineInputSnapshot[];
  createdByUserId: string;
  /** Null while the baseline is the active one. */
  replacedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewEvaluationBaseline {
  flowId: string;
  taskId: string;
  iteration: number;
  sourceExecutionId: string;
  sourceMode: EvaluationBaselineSourceMode;
  inputSnapshots?: FlowEvaluationBaselineInputSnapshot[];
  createdByUserId: string;
}

export function toEvaluationBaselineRecord(row: BaselineRow): FlowEvaluationBaselineRecord {
  return {
    ...row,
    sourceMode: row.sourceMode as EvaluationBaselineSourceMode,
    inputSnapshots: (row.inputSnapshots ?? []) as unknown as FlowEvaluationBaselineInputSnapshot[],
  };
}

/** A soft reference: kept as given, lower-cased when it is an ObjectId. */
function softRef(value: string): string {
  return isObjectId(value) ? normalizeObjectId(value) : value;
}

/**
 * PostgreSQL playbook.evaluation_baselines repository (roadmap P5). A task has at most one active
 * baseline (`replaced_at` null); replacing one stamps the previous ones. `source_execution_id` is a soft
 * reference.
 */
@Injectable()
export class EvaluationBaselineRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private activeInTask(flowId: string, taskId: string): SQL {
    return and(eq(b.flowId, normalizeObjectId(flowId)), eq(b.taskId, taskId), isNull(b.replacedAt))!;
  }

  /** The task's newest active baseline, optionally for one iteration. */
  async findActive(flowId: string, taskId: string, iteration?: number): Promise<FlowEvaluationBaselineRecord | null> {
    // The controller passes the query string through: '2' is iteration 2, a non-number matches nothing.
    const it = iteration === undefined ? undefined : Number(iteration);
    if (!isObjectId(flowId) || (it !== undefined && !Number.isInteger(it))) return null;
    const [row] = await this.q
      .select()
      .from(b)
      .where(and(this.activeInTask(flowId, taskId), it !== undefined ? eq(b.iteration, it) : undefined))
      .orderBy(desc(b.createdAt), desc(b.id))
      .limit(1);
    return row ? toEvaluationBaselineRecord(row) : null;
  }

  /** Stamps every active baseline of the task (any iteration) as replaced; returns how many. */
  async retireActive(flowId: string, taskId: string): Promise<number> {
    if (!isObjectId(flowId)) return 0;
    const now = new Date();
    const rows = await this.q.update(b).set({ replacedAt: now, updatedAt: now }).where(this.activeInTask(flowId, taskId)).returning({ id: b.id });
    return rows.length;
  }

  /**
   * Retires the task's active baselines and inserts the new one, in one transaction serialised per task
   * so two concurrent replacements leave a single active baseline. Null (nothing changed) when the flow
   * does not exist.
   */
  async replaceActive(input: NewEvaluationBaseline): Promise<FlowEvaluationBaselineRecord | null> {
    if (!isObjectId(input.flowId)) return null;
    const flowId = normalizeObjectId(input.flowId);
    try {
      return await withTransaction(this.db, async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`playbook.evaluation-baseline:${flowId}:${input.taskId}`}, 0))`);
        await this.retireActive(flowId, input.taskId);
        const [row] = await this.q
          .insert(b)
          .values({
            id: newObjectId(),
            flowId,
            taskId: input.taskId,
            iteration: Number.isFinite(input.iteration) ? Math.trunc(input.iteration) : 0,
            sourceExecutionId: softRef(input.sourceExecutionId),
            sourceMode: input.sourceMode,
            inputSnapshots: stripNul(input.inputSnapshots ?? []) as unknown as Record<string, unknown>[],
            createdByUserId: softRef(input.createdByUserId),
          })
          .returning();
        return toEvaluationBaselineRecord(row);
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) return null;
      throw err;
    }
  }
}
