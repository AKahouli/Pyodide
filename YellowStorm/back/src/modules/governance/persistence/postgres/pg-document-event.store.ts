import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { GOVERNANCE_EVENT_STORE, type AppendGovernanceDocumentEventInput, type GovernanceEventStore } from '../document-event-store';
import type { GovernanceDocumentEventRecord } from '../governance-records';

const EVENTS = schema.governanceDocumentEvents;
type EventRow = typeof EVENTS.$inferSelect;

export function eventRowToRecord(row: EventRow): GovernanceDocumentEventRecord {
  return {
    id: row.id,
    programId: row.programId,
    governanceDocumentId: row.governanceDocumentId,
    documentId: row.documentId,
    eventType: row.eventType,
    actorId: row.actorId ?? undefined,
    actorType: row.actorType as GovernanceDocumentEventRecord['actorType'],
    actorEmail: row.actorEmail ?? undefined,
    occurredAt: row.occurredAt,
    reason: row.reason ?? undefined,
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    metadata: row.metadata ?? {},
    correlationId: row.correlationId ?? undefined,
    causationId: row.causationId ?? undefined,
    deduplicationKey: row.deduplicationKey ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgGovernanceEventStore implements GovernanceEventStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async append(input: AppendGovernanceDocumentEventInput): Promise<GovernanceDocumentEventRecord> {
    const occurredAt = input.occurredAt ?? new Date();
    const rows = await this.q
      .insert(EVENTS)
      .values({
        id: newObjectId(),
        programId: input.programId,
        governanceDocumentId: input.governanceDocumentId,
        documentId: input.documentId,
        eventType: input.eventType,
        actorId: input.actorId ?? null,
        actorType: input.actorType ?? (input.actorId ? 'user' : 'system'),
        actorEmail: input.actorEmail ?? null,
        occurredAt,
        reason: input.reason ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        metadata: input.metadata ?? {},
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        deduplicationKey: input.deduplicationKey ?? null,
      })
      .onConflictDoNothing({
        target: [EVENTS.governanceDocumentId, EVENTS.deduplicationKey],
        where: sql`deduplication_key IS NOT NULL`,
      })
      .returning();
    if (rows[0]) return eventRowToRecord(rows[0]);
    // Partial unique index fires only for non-null keys; for keyed appends the
    // stored event wins (same idempotency as the Mongo 11000 fallback).
    const existing = await this.findByDeduplicationKey(input.governanceDocumentId, input.deduplicationKey as string);
    if (existing) return existing;
    throw new Error('Governance document event append failed');
  }

  async findByDeduplicationKey(governanceDocumentId: string, key: string): Promise<GovernanceDocumentEventRecord | null> {
    const rows = await this.q
      .select()
      .from(EVENTS)
      .where(and(eq(EVENTS.governanceDocumentId, governanceDocumentId), eq(EVENTS.deduplicationKey, key)))
      .limit(1);
    return rows[0] ? eventRowToRecord(rows[0]) : null;
  }

  async listByGovernanceDocument(governanceDocumentId: string): Promise<GovernanceDocumentEventRecord[]> {
    const rows = await this.q
      .select()
      .from(EVENTS)
      .where(eq(EVENTS.governanceDocumentId, governanceDocumentId))
      .orderBy(desc(EVENTS.occurredAt));
    return rows.map(eventRowToRecord);
  }
}
