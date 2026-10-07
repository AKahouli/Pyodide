import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyTaskRecord } from '../worky.types';

const t = schema.workyTasks;

type TaskRow = typeof t.$inferSelect;

/** Execution states after which a task no longer moves. */
export const TERMINAL_EXECUTION_STATES = ['done', 'failed', 'canceled', 'superseded'] as const;

export function toTaskRecord(row: TaskRow): WorkyTaskRecord {
  const { budgetEstimateUsd, budgetActualUsd, budgetTokensEstimate, budgetTokensActual, ...rest } = row;
  return {
    ...rest,
    budget: {
      estimateUsd: budgetEstimateUsd,
      actualUsd: budgetActualUsd,
      tokensEstimate: budgetTokensEstimate,
      tokensActual: budgetTokensActual,
    },
  };
}

export interface NewWorkyTask {
  streamId: string;
  title: string;
  description?: string;
  lane: string;
  planningStatus?: string;
  priority?: string;
  assigneeType?: string;
  dependsOn?: string[];
  requiredTools?: string[];
  actionCategory: string;
  acceptanceCriteria?: string[];
  budgetEstimateUsd?: number;
  tokensEstimate?: number;
}

/** The columns a caller may change on a task. `updatedAt` is always bumped. */
export interface WorkyTaskPatch {
  title?: string;
  description?: string;
  lane?: string;
  executionState?: string;
  controlState?: string;
  priority?: string;
  assigneeType?: string;
  assigneeId?: string | null;
  actionCategory?: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  theoreticalDeadlineAt?: Date | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? stripNul(value) : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => stripNul(v)) : [];
}

/** PostgreSQL worky.tasks repository (roadmap P7). */
@Injectable()
export class WorkyTaskRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(input: NewWorkyTask): Promise<WorkyTaskRecord> {
    const [row] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        title: input.title,
        description: input.description ?? '',
        lane: input.lane,
        planningStatus: input.planningStatus ?? 'pending',
        priority: input.priority ?? 'medium',
        assigneeType: input.assigneeType ?? 'unassigned',
        dependsOn: (input.dependsOn ?? []).map(normalizeObjectId),
        requiredTools: input.requiredTools ?? [],
        actionCategory: input.actionCategory,
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        budgetEstimateUsd: input.budgetEstimateUsd ?? 0,
        budgetTokensEstimate: Math.round(input.tokensEstimate ?? 0),
      })
      .returning();
    return toTaskRecord(row);
  }

  async findById(id: string): Promise<WorkyTaskRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(t).where(eq(t.id, normalizeObjectId(id))).limit(1);
    return row ? toTaskRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<WorkyTaskRecord[]> {
    const valid = ids.filter(isObjectId).map(normalizeObjectId);
    if (valid.length === 0) return [];
    const rows = await this.q.select().from(t).where(inArray(t.id, valid));
    return rows.map(toTaskRecord);
  }

  /** The ids of a stream's tasks: the plan-delta graph check needs nothing else. */
  async listIdsByStream(streamId: string): Promise<string[]> {
    if (!isObjectId(streamId)) return [];
    const rows = await this.q.select({ id: t.id }).from(t).where(eq(t.streamId, normalizeObjectId(streamId)));
    return rows.map((row) => row.id);
  }

  async listByStream(streamId: string): Promise<WorkyTaskRecord[]> {
    if (!isObjectId(streamId)) return [];
    const rows = await this.q.select().from(t).where(eq(t.streamId, normalizeObjectId(streamId))).orderBy(asc(t.createdAt), asc(t.id));
    return rows.map(toTaskRecord);
  }

  /** The board: the tasks in the given lanes, least recently updated first. */
  async listForBoard(streamId: string, lanes: readonly string[], limit: number): Promise<WorkyTaskRecord[]> {
    if (!isObjectId(streamId)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(and(eq(t.streamId, normalizeObjectId(streamId)), inArray(t.lane, [...lanes])))
      .orderBy(asc(t.updatedAt), asc(t.id))
      .limit(limit);
    return rows.map(toTaskRecord);
  }

  async countByStream(streamId: string): Promise<number> {
    if (!isObjectId(streamId)) return 0;
    const [row] = await this.q.select({ count: sql<number>`count(*)::int` }).from(t).where(eq(t.streamId, normalizeObjectId(streamId)));
    return row?.count ?? 0;
  }

  async update(id: string, patch: WorkyTaskPatch): Promise<WorkyTaskRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(t)
      .set(this.toSet(patch))
      .where(eq(t.id, normalizeObjectId(id)))
      .returning();
    return row ? toTaskRecord(row) : null;
  }

  /** Same as update, but only when the task belongs to `streamId`. */
  async updateInStream(id: string, streamId: string, patch: WorkyTaskPatch): Promise<WorkyTaskRecord | null> {
    if (!isObjectId(id) || !isObjectId(streamId)) return null;
    const [row] = await this.q
      .update(t)
      .set(this.toSet(patch))
      .where(and(eq(t.id, normalizeObjectId(id)), eq(t.streamId, normalizeObjectId(streamId))))
      .returning();
    return row ? toTaskRecord(row) : null;
  }

  private toSet(patch: WorkyTaskPatch): Partial<typeof t.$inferInsert> {
    return {
      ...patch,
      assigneeId: patch.assigneeId === undefined ? undefined : patch.assigneeId ? normalizeObjectId(patch.assigneeId) : null,
      dependsOn: patch.dependsOn?.map(normalizeObjectId),
      updatedAt: new Date(),
    };
  }

  /**
   * Adds an LLM/tool cost to the task's actuals. Returns the task afterwards, or null when it does
   * not exist, so the caller can compare against the estimate.
   */
  async addActualCost(id: string, costUsd: number, tokens: number): Promise<WorkyTaskRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(t)
      .set({
        budgetActualUsd: sql`${t.budgetActualUsd} + ${costUsd}`,
        budgetTokensActual: sql`${t.budgetTokensActual} + ${Math.round(tokens)}`,
        updatedAt: new Date(),
      })
      .where(eq(t.id, normalizeObjectId(id)))
      .returning();
    return row ? toTaskRecord(row) : null;
  }

  /**
   * Moves a task that is not yet terminal to `transition` and stamps completion and duration.
   * False when the task is missing or already terminal (nothing changed).
   */
  async completeIfOpen(id: string, transition: { lane: string; executionState: string }, completedAt: Date): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(t)
      .set({
        lane: transition.lane,
        executionState: transition.executionState,
        completedAt,
        durationMs: sql`CASE WHEN ${t.startedAt} IS NULL THEN NULL ELSE GREATEST(0, floor(extract(epoch FROM (${completedAt.toISOString()}::timestamptz - ${t.startedAt})) * 1000))::bigint END`,
        updatedAt: completedAt,
      })
      .where(and(eq(t.id, normalizeObjectId(id)), notInArray(t.executionState, [...TERMINAL_EXECUTION_STATES])))
      .returning({ id: t.id });
    return rows.length > 0;
  }

  /**
   * Mirrors one manager plan step: creates the task or overwrites the mapped fields of the one with
   * the same (stream, step id). `set` is the output of mapPlanStep; only the known fields are read.
   */
  async upsertMirrored(streamId: string, externalId: string, set: Record<string, unknown>): Promise<WorkyTaskRecord> {
    const fields = {
      title: typeof set.title === 'string' && set.title ? stripNul(set.title) : `Step ${intOrNull(set.ordinal) ?? ''}`.trim(),
      description: typeof set.description === 'string' ? stripNul(set.description) : '',
      ordinal: intOrNull(set.ordinal),
      lane: typeof set.lane === 'string' ? set.lane : 'backlog',
      executionState: typeof set.executionState === 'string' ? set.executionState : 'not_started',
      result: textOrNull(set.result),
      blockedReason: textOrNull(set.blockedReason),
      wave: intOrNull(set.wave),
      dependsOnStepIds: stringArray(set.dependsOnStepIds),
      assigneeKey: textOrNull(set.assigneeKey),
      kind: typeof set.kind === 'string' && set.kind ? set.kind : 'execute',
      question: textOrNull(set.question),
      interruptId: textOrNull(set.interruptId),
      assigneeName: textOrNull(set.assigneeName),
      assigneeRole: textOrNull(set.assigneeRole),
      isPersona: set.isPersona === true,
      isDynamicDelegate: set.isDynamicDelegate === true,
    };
    const [row] = await this.q
      .insert(t)
      .values({ id: newObjectId(), streamId: normalizeObjectId(streamId), externalId, ...fields })
      .onConflictDoUpdate({
        target: [t.streamId, t.externalId],
        targetWhere: sql`${t.externalId} IS NOT NULL`,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning();
    return toTaskRecord(row);
  }
}
