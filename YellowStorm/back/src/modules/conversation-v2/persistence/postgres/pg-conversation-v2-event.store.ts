import { Inject, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, withTransaction } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { ConversationV2EventTypeName } from '../../types/conversation-v2-persistence.types';
import type { ConversationV2Event as WireEvent } from '../../types/conversation-v2.types';
import type {
  AppendResult,
  ConversationV2EventRecord,
  ConversationV2EventStore,
} from '../conversation-v2-event.store';
import { PgConversationV2SessionStore } from './pg-conversation-v2-session.store';

type EventRow = typeof schema.conversationV2Events.$inferSelect;

/**
 * PostgreSQL conversation_v2.events store.
 * `append` mirrors Mongo semantics: bump counters first, then insert-on-conflict
 * by (session_id, event_id); duplicate eventIds leave a wasted sequence slot.
 */
export class PgConversationV2EventStore implements ConversationV2EventStore {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly sessions: PgConversationV2SessionStore,
  ) {}

  private get q(): NodePgDatabase<typeof schema> {
    return resolveQueryable(this.db) as NodePgDatabase<typeof schema>;
  }

  private static toRecord(row: EventRow): ConversationV2EventRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      sequence: row.sequence,
      eventId: row.eventId,
      type: row.type as ConversationV2EventTypeName,
      emittedAt: row.emittedAt,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      modelId: row.modelId ?? null,
      createdAt: row.createdAt,
    };
  }

  async append(sessionId: string, event: WireEvent): Promise<AppendResult> {
    if (!isObjectId(sessionId)) {
      throw new NotFoundException(`Invalid session id ${sessionId}`);
    }
    const sid = normalizeObjectId(sessionId);

    return withTransaction(this.db, async () => {
      const sequence = await this.sessions.incrementEventCounters(sid);
      if (sequence == null) {
        throw new NotFoundException(`Session pointer ${sessionId} not found`);
      }

      const payloadWithoutHeader = { ...(event.payload as unknown as Record<string, unknown>) };
      delete payloadWithoutHeader.event_id;
      delete payloadWithoutHeader.timestamp;

      const inserted = await this.q
        .insert(schema.conversationV2Events)
        .values({
          id: newObjectId(),
          sessionId: sid,
          eventId: event.payload.event_id,
          sequence,
          type: event.type,
          emittedAt: event.payload.timestamp,
          payload: payloadWithoutHeader,
        })
        .onConflictDoNothing({
          target: [schema.conversationV2Events.sessionId, schema.conversationV2Events.eventId],
        })
        .returning({ id: schema.conversationV2Events.id });

      if (inserted.length === 1) {
        return { sequence, inserted: true };
      }

      const [existing] = await this.q
        .select({ sequence: schema.conversationV2Events.sequence })
        .from(schema.conversationV2Events)
        .where(
          and(
            eq(schema.conversationV2Events.sessionId, sid),
            eq(schema.conversationV2Events.eventId, event.payload.event_id),
          ),
        )
        .limit(1);

      return {
        sequence: existing?.sequence ?? sequence,
        inserted: false,
      };
    });
  }

  async listSince(
    sessionId: string,
    since: number,
    limit: number,
  ): Promise<ConversationV2EventRecord[]> {
    if (!isObjectId(sessionId)) return [];
    const rows = await this.q
      .select()
      .from(schema.conversationV2Events)
      .where(
        and(
          eq(schema.conversationV2Events.sessionId, normalizeObjectId(sessionId)),
          gt(schema.conversationV2Events.sequence, since),
        ),
      )
      .orderBy(asc(schema.conversationV2Events.sequence))
      .limit(limit);
    return rows.map(PgConversationV2EventStore.toRecord);
  }

  async listByType(
    sessionId: string,
    type: ConversationV2EventTypeName,
  ): Promise<ConversationV2EventRecord[]> {
    if (!isObjectId(sessionId)) return [];
    const rows = await this.q
      .select()
      .from(schema.conversationV2Events)
      .where(
        and(
          eq(schema.conversationV2Events.sessionId, normalizeObjectId(sessionId)),
          eq(schema.conversationV2Events.type, type),
        ),
      )
      .orderBy(asc(schema.conversationV2Events.sequence));
    return rows.map(PgConversationV2EventStore.toRecord);
  }

  async tagModel(sessionId: string, eventId: string, modelId: string): Promise<void> {
    if (!isObjectId(sessionId)) return;
    await this.q
      .update(schema.conversationV2Events)
      .set({ modelId })
      .where(
        and(
          eq(schema.conversationV2Events.sessionId, normalizeObjectId(sessionId)),
          eq(schema.conversationV2Events.eventId, eventId),
        ),
      );
  }
}
