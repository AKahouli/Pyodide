import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyInteractionRecord } from '../worky.types';

const t = schema.workyInteractions;

export interface NewWorkyInteraction {
  streamId: string;
  taskId?: string | null;
  type: string;
  targetUserId?: string | null;
  question: string;
  options?: string[];
  blockingScope?: string;
  blocksTaskIds?: string[];
  metadata?: Record<string, unknown>;
}

/** PostgreSQL worky.interactions repository (roadmap P7). */
@Injectable()
export class WorkyInteractionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(input: NewWorkyInteraction): Promise<WorkyInteractionRecord> {
    const [row] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        taskId: input.taskId ? normalizeObjectId(input.taskId) : null,
        type: input.type,
        targetUserId: input.targetUserId ? normalizeObjectId(input.targetUserId) : null,
        question: stripNul(input.question),
        options: (input.options ?? []).map((option) => stripNul(option)),
        blockingScope: input.blockingScope ?? 'stream',
        blocksTaskIds: (input.blocksTaskIds ?? []).map(normalizeObjectId),
        metadata: stripNul(input.metadata ?? {}),
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<WorkyInteractionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(t).where(eq(t.id, normalizeObjectId(id))).limit(1);
    return row ?? null;
  }

  /** The stream's pending interactions, oldest first: they are what blocks the board. */
  async listPending(streamId: string): Promise<WorkyInteractionRecord[]> {
    if (!isObjectId(streamId)) return [];
    return this.q
      .select()
      .from(t)
      .where(and(eq(t.streamId, normalizeObjectId(streamId)), eq(t.status, 'pending')))
      .orderBy(asc(t.createdAt), asc(t.id));
  }

  async listByStream(streamId: string): Promise<WorkyInteractionRecord[]> {
    if (!isObjectId(streamId)) return [];
    return this.q.select().from(t).where(eq(t.streamId, normalizeObjectId(streamId))).orderBy(asc(t.createdAt), asc(t.id));
  }

  /** Records the answer, but only while the interaction is still pending. Null when it no longer is. */
  async respond(id: string, outcome: { status: 'responded' | 'canceled'; response: string }): Promise<WorkyInteractionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(t)
      .set({ status: outcome.status, response: stripNul(outcome.response), respondedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(t.id, normalizeObjectId(id)), eq(t.status, 'pending')))
      .returning();
    return row ?? null;
  }
}
