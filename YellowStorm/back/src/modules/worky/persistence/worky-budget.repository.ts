import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyBudgetReservationRecord, WorkyCostEventRecord } from '../worky.types';

const r = schema.workyBudgetReservations;
const c = schema.workyCostEvents;

export type WorkyReservationStatus = 'reserved' | 'released' | 'consumed' | 'denied';

export interface NewWorkyCostEvent {
  streamId: string;
  taskId: string | null;
  type: string;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface WorkyCostTotals {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  eventCount: number;
}

/** PostgreSQL worky.budget_reservations and worky.cost_events repository (roadmap P7). */
@Injectable()
export class WorkyBudgetRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async createReservation(input: {
    streamId: string;
    taskId: string;
    amountUsd: number;
    tokens: number;
    status: WorkyReservationStatus;
  }): Promise<WorkyBudgetReservationRecord> {
    const [row] = await this.q
      .insert(r)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        taskId: normalizeObjectId(input.taskId),
        amountUsd: input.amountUsd,
        tokens: Math.round(input.tokens),
        status: input.status,
      })
      .returning();
    return row;
  }

  async findReservation(id: string): Promise<WorkyBudgetReservationRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(r).where(eq(r.id, normalizeObjectId(id))).limit(1);
    return row ?? null;
  }

  /** Moves a reservation from one status to another, only if it still has `from`. Null when it did not. */
  async transitionReservation(id: string, from: WorkyReservationStatus, to: WorkyReservationStatus): Promise<WorkyBudgetReservationRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(r)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(r.id, normalizeObjectId(id)), eq(r.status, from)))
      .returning();
    return row ?? null;
  }

  /** Marks the task's open reservations consumed (its actual cost overran the estimate). */
  async consumeOpenReservations(taskId: string): Promise<number> {
    if (!isObjectId(taskId)) return 0;
    const rows = await this.q
      .update(r)
      .set({ status: 'consumed', updatedAt: new Date() })
      .where(and(eq(r.taskId, normalizeObjectId(taskId)), eq(r.status, 'reserved')))
      .returning({ id: r.id });
    return rows.length;
  }

  async insertCostEvent(input: NewWorkyCostEvent): Promise<WorkyCostEventRecord> {
    const [row] = await this.q
      .insert(c)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        taskId: input.taskId ? normalizeObjectId(input.taskId) : null,
        type: input.type,
        provider: input.provider,
        modelId: input.modelId,
        inputTokens: Math.round(input.inputTokens),
        outputTokens: Math.round(input.outputTokens),
        costUsd: input.costUsd,
      })
      .returning();
    return row;
  }

  /** Everything the stream has spent, from its cost events. */
  async costTotals(streamId: string): Promise<WorkyCostTotals> {
    if (!isObjectId(streamId)) return { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, eventCount: 0 };
    const [row] = await this.q
      .select({
        totalCostUsd: sql<string>`coalesce(sum(${c.costUsd}), 0)`,
        totalInputTokens: sql<string>`coalesce(sum(${c.inputTokens}), 0)`,
        totalOutputTokens: sql<string>`coalesce(sum(${c.outputTokens}), 0)`,
        eventCount: sql<number>`count(*)::int`,
      })
      .from(c)
      .where(eq(c.streamId, normalizeObjectId(streamId)));
    return {
      totalCostUsd: Number(row?.totalCostUsd ?? 0),
      totalInputTokens: Number(row?.totalInputTokens ?? 0),
      totalOutputTokens: Number(row?.totalOutputTokens ?? 0),
      eventCount: row?.eventCount ?? 0,
    };
  }
}
