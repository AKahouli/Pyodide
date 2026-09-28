import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyMessageComponentRecord, WorkyMessageRecord } from '../worky.types';

const m = schema.workyMessages;
const c = schema.workyMessageComponents;

export interface NewWorkyMessage {
  streamId: string;
  role: 'owner' | 'manager' | 'system';
  content: string;
  turnId?: string | null;
  origin?: 'voice' | null;
}

/** The fields of a manager message row, as mapMessage produces them. */
export interface MirroredMessageFields {
  turnId: string | null;
  role: string;
  content: string;
  emittedAt: Date;
}

function messageFields(set: Record<string, unknown>): MirroredMessageFields {
  return {
    turnId: typeof set.turnId === 'string' ? set.turnId : null,
    role: typeof set.role === 'string' ? set.role : 'manager',
    content: typeof set.content === 'string' ? stripNul(set.content) : '',
    emittedAt: set.emittedAt instanceof Date ? set.emittedAt : new Date(),
  };
}

/** PostgreSQL worky.messages and worky.message_components repository (roadmap P7). */
@Injectable()
export class WorkyMessageRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(input: NewWorkyMessage): Promise<WorkyMessageRecord> {
    const [row] = await this.q
      .insert(m)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        role: input.role,
        content: stripNul(input.content),
        turnId: input.turnId ?? null,
        origin: input.origin ?? null,
        emittedAt: new Date(),
      })
      .returning();
    return row;
  }

  /** The last `limit` messages of a stream, oldest first. */
  async listRecent(streamId: string, limit: number): Promise<WorkyMessageRecord[]> {
    if (!isObjectId(streamId)) return [];
    const rows = await this.q
      .select()
      .from(m)
      .where(eq(m.streamId, normalizeObjectId(streamId)))
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(limit);
    return rows.reverse();
  }

  async listComponents(streamId: string, messageExternalIds: string[]): Promise<WorkyMessageComponentRecord[]> {
    if (!isObjectId(streamId) || messageExternalIds.length === 0) return [];
    return this.q
      .select()
      .from(c)
      .where(and(eq(c.streamId, normalizeObjectId(streamId)), inArray(c.messageExternalId, messageExternalIds)))
      .orderBy(asc(c.ordinal), asc(c.createdAt), asc(c.id));
  }

  /**
   * Mirrors one manager message and returns the stored row.
   *
   * The manager echoes the owner's own message back through Electric, but the message was already
   * stored locally without an external id. An owner row therefore first adopts the most recent
   * un-mirrored local copy with the same content (stamping it with the manager's id), instead of
   * inserting a second copy; replays then match that external id and update in place.
   */
  async mirror(streamId: string, externalId: string, set: Record<string, unknown>): Promise<WorkyMessageRecord> {
    const stream = normalizeObjectId(streamId);
    const fields = messageFields(set);
    if (fields.role === 'owner') {
      const adopted = await this.q
        .update(m)
        .set({ ...fields, externalId, updatedAt: new Date() })
        .where(eq(
          m.id,
          this.q
            .select({ id: m.id })
            .from(m)
            .where(and(eq(m.streamId, stream), eq(m.role, 'owner'), eq(m.content, fields.content), isNull(m.externalId)))
            .orderBy(desc(m.createdAt), desc(m.id))
            .limit(1),
        ))
        .returning();
      if (adopted[0]) return adopted[0];
    }
    const [row] = await this.q
      .insert(m)
      .values({ id: newObjectId(), streamId: stream, externalId, ...fields })
      .onConflictDoUpdate({
        target: [m.streamId, m.externalId],
        targetWhere: sql`${m.externalId} IS NOT NULL`,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async upsertComponent(streamId: string, externalId: string, set: Record<string, unknown>): Promise<WorkyMessageComponentRecord> {
    const fields = {
      messageExternalId: typeof set.messageExternalId === 'string' ? set.messageExternalId : '',
      ordinal: typeof set.ordinal === 'number' ? Math.trunc(set.ordinal) : 0,
      type: typeof set.type === 'string' ? set.type : '',
      data: stripNul((set.data as Record<string, unknown> | undefined) ?? {}),
    };
    const [row] = await this.q
      .insert(c)
      .values({ id: newObjectId(), streamId: normalizeObjectId(streamId), externalId, ...fields })
      .onConflictDoUpdate({
        target: [c.streamId, c.externalId],
        targetWhere: sql`${c.externalId} IS NOT NULL`,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
}
