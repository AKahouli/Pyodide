import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyAuditEventRecord, WorkyEphemeralWorkerRecord, WorkyTraceRecord } from '../worky.types';

const a = schema.workyAuditEvents;
const tr = schema.workyTraces;
const w = schema.workyEphemeralWorkers;

export interface NewWorkyAuditEvent {
  /** The scope the event belongs to: a stream, or the owner / workspace for non-stream events. */
  streamId: string;
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

export interface NewWorkyTrace {
  streamId: string;
  taskId: string;
  kind: 'tool' | 'model';
  name: string;
  summary: string;
  rawPayloadUri: string | null;
  durationMs: number;
}

/** PostgreSQL worky.audit_events, worky.traces and worky.ephemeral_workers repository (roadmap P7). */
@Injectable()
export class WorkyAuditRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async append(input: NewWorkyAuditEvent): Promise<void> {
    await this.q.insert(a).values({
      id: newObjectId(),
      streamId: normalizeObjectId(input.streamId),
      actorUserId: input.actorUserId && isObjectId(input.actorUserId) ? normalizeObjectId(input.actorUserId) : null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId && isObjectId(input.targetId) ? normalizeObjectId(input.targetId) : null,
      details: stripNul(input.details ?? {}),
    });
  }

  /** The scope's audit trail, oldest first. */
  async listForScope(streamId: string): Promise<WorkyAuditEventRecord[]> {
    if (!isObjectId(streamId)) return [];
    return this.q.select().from(a).where(eq(a.streamId, normalizeObjectId(streamId))).orderBy(asc(a.occurredAt), asc(a.id));
  }

  // ---------------------------------------------------------------- traces

  async createTrace(input: NewWorkyTrace): Promise<WorkyTraceRecord> {
    const [row] = await this.q
      .insert(tr)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        taskId: normalizeObjectId(input.taskId),
        kind: input.kind,
        name: input.name,
        summary: stripNul(input.summary),
        rawPayloadUri: input.rawPayloadUri,
        durationMs: Math.max(0, Math.round(input.durationMs)),
      })
      .returning();
    return row;
  }

  async listTracesForStream(streamId: string, limit: number): Promise<WorkyTraceRecord[]> {
    if (!isObjectId(streamId)) return [];
    return this.q.select().from(tr).where(eq(tr.streamId, normalizeObjectId(streamId))).orderBy(asc(tr.createdAt), asc(tr.id)).limit(limit);
  }

  async listTracesForTask(streamId: string, taskId: string, limit: number): Promise<WorkyTraceRecord[]> {
    if (!isObjectId(streamId) || !isObjectId(taskId)) return [];
    return this.q
      .select()
      .from(tr)
      .where(and(eq(tr.streamId, normalizeObjectId(streamId)), eq(tr.taskId, normalizeObjectId(taskId))))
      .orderBy(asc(tr.createdAt), asc(tr.id))
      .limit(limit);
  }

  // ---------------------------------------------------------------- workers

  async listWorkersByStream(streamId: string): Promise<WorkyEphemeralWorkerRecord[]> {
    if (!isObjectId(streamId)) return [];
    return this.q.select().from(w).where(eq(w.streamId, normalizeObjectId(streamId))).orderBy(asc(w.createdAt), asc(w.id));
  }
}
