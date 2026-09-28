import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyPlanDeltaRecord, WorkyPlanVersionRecord } from '../worky.types';

const d = schema.workyPlanDeltas;
const v = schema.workyPlanVersions;

export interface NewWorkyPlanDelta {
  streamId: string;
  basePlanVersion: number;
  resultPlanVersion: number | null;
  phase: string;
  triggerEventId: string;
  status: string;
  applyMode: string;
  reason: string;
  createdBy: string;
  body: Record<string, unknown>;
}

export interface NewWorkyPlanVersion {
  streamId: string;
  versionNumber: number;
  phase: string;
  createdBy: string;
  createdFromMessageId?: string | null;
  triggerEventId?: string | null;
  summary: string;
}

/** PostgreSQL worky.plan_deltas and worky.plan_versions repository (roadmap P7). */
@Injectable()
export class WorkyPlanRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async createDelta(input: NewWorkyPlanDelta): Promise<WorkyPlanDeltaRecord> {
    const [row] = await this.q
      .insert(d)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        basePlanVersion: input.basePlanVersion,
        resultPlanVersion: input.resultPlanVersion,
        phase: input.phase,
        triggerEventId: input.triggerEventId,
        status: input.status,
        applyMode: input.applyMode,
        reason: stripNul(input.reason),
        createdBy: normalizeObjectId(input.createdBy),
        body: stripNul(input.body),
        appliedAt: input.status === 'applied' ? new Date() : null,
      })
      .returning();
    return row;
  }

  async findDeltaById(id: string): Promise<WorkyPlanDeltaRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(d).where(eq(d.id, normalizeObjectId(id))).limit(1);
    return row ?? null;
  }

  /** Marks a delta that was waiting for approval as applied. False when it no longer was pending. */
  async markApplied(id: string, outcome: { resultPlanVersion: number; approvedBy: string }): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(d)
      .set({
        status: 'applied',
        resultPlanVersion: outcome.resultPlanVersion,
        appliedAt: new Date(),
        approvedBy: normalizeObjectId(outcome.approvedBy),
        updatedAt: new Date(),
      })
      .where(and(eq(d.id, normalizeObjectId(id)), eq(d.status, 'pending_approval')))
      .returning({ id: d.id });
    return rows.length > 0;
  }

  async createVersion(input: NewWorkyPlanVersion): Promise<WorkyPlanVersionRecord> {
    const [row] = await this.q
      .insert(v)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        versionNumber: input.versionNumber,
        phase: input.phase,
        createdBy: normalizeObjectId(input.createdBy),
        createdFromMessageId: input.createdFromMessageId ? normalizeObjectId(input.createdFromMessageId) : null,
        triggerEventId: input.triggerEventId ?? null,
        summary: stripNul(input.summary),
      })
      .returning();
    return row;
  }
}
