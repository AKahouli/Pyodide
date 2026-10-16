import { Inject, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, withTransaction } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { AppBuilderEventTypeName } from '../../types/app-builder-persistence.types';
import type { AppBuilderEvent as WireEvent } from '../../types/app-builder.types';
import type {
  AppendResult,
  AppBuilderEventRecord,
  AppBuilderEventStore,
} from '../app-builder-event.store';
import { PgAppBuilderSessionStore } from './pg-app-builder-session.store';

type EventRow = typeof schema.appBuilderEvents.$inferSelect;

/**
 * PostgreSQL conversation_v2.events store.
 * `append` mirrors Mongo semantics: bump counters first, then insert-on-conflict
 * by (session_id, event_id); duplicate eventIds leave a wasted sequence slot.
 */
export class PgAppBuilderEventStore implements AppBuilderEventStore {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly sessions: PgAppBuilderSessionStore,
  ) {}

  private get q(): NodePgDatabase<typeof schema> {
    return resolveQueryable(this.db);
  }

  private static toRecord(row: EventRow): AppBuilderEventRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      sequence: row.sequence,
      eventId: row.eventId,
      type: row.type as AppBuilderEventTypeName,
      emittedAt: row.emittedAt,
      payload: (row.payload ?? {}),
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
        .insert(schema.appBuilderEvents)
        .values({
          id: newObjectId(),
          sessionId: sid,
          eventId: event.payload.event_id,
          sequence,
          type: event.type,
          emittedAt: event.payload.timestamp,
          payload: stripNul(payloadWithoutHeader),
        })
        .onConflictDoNothing({
          target: [schema.appBuilderEvents.sessionId, schema.appBuilderEvents.eventId],
        })
        .returning({ id: schema.appBuilderEvents.id });

      if (inserted.length === 1) {
        return { sequence, inserted: true };
      }

      const [existing] = await this.q
        .select({ sequence: schema.appBuilderEvents.sequence })
        .from(schema.appBuilderEvents)
        .where(
          and(
            eq(schema.appBuilderEvents.sessionId, sid),
            eq(schema.appBuilderEvents.eventId, event.payload.event_id),
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
  ): Promise<AppBuilderEventRecord[]> {
    if (!isObjectId(sessionId)) return [];
    const rows = await this.q
      .select()
      .from(schema.appBuilderEvents)
      .where(
        and(
          eq(schema.appBuilderEvents.sessionId, normalizeObjectId(sessionId)),
          gt(schema.appBuilderEvents.sequence, since),
        ),
      )
      .orderBy(asc(schema.appBuilderEvents.sequence))
      .limit(limit);
    return rows.map(PgAppBuilderEventStore.toRecord);
  }

  async listByType(
    sessionId: string,
    type: AppBuilderEventTypeName,
  ): Promise<AppBuilderEventRecord[]> {
    if (!isObjectId(sessionId)) return [];
    const rows = await this.q
      .select()
      .from(schema.appBuilderEvents)
      .where(
        and(
          eq(schema.appBuilderEvents.sessionId, normalizeObjectId(sessionId)),
          eq(schema.appBuilderEvents.type, type),
        ),
      )
      .orderBy(asc(schema.appBuilderEvents.sequence));
    return rows.map(PgAppBuilderEventStore.toRecord);
  }

  async tagModel(sessionId: string, eventId: string, modelId: string): Promise<void> {
    if (!isObjectId(sessionId)) return;
    await this.q
      .update(schema.appBuilderEvents)
      .set({ modelId })
      .where(
        and(
          eq(schema.appBuilderEvents.sessionId, normalizeObjectId(sessionId)),
          eq(schema.appBuilderEvents.eventId, eventId),
        ),
      );
  }
}
