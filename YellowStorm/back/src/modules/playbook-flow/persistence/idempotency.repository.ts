import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const r = schema.playbookIdempotencyRecords;

export type IdempotencyRecord = typeof r.$inferSelect;

export interface NewIdempotencyReservation {
  ownerId: string;
  idempotencyKey: string;
  payloadHash: string;
  expiresAt: Date;
}

/** What the steps after a reservation record on it. `updatedAt` is always bumped. */
export interface IdempotencyRecordPatch {
  executionId?: string;
  responseBody?: Record<string, unknown>;
  expectedStateHash?: string;
  expectedDefinitionRevision?: number;
}

/**
 * PostgreSQL playbook.idempotency_records repository (roadmap P5). One record per (owner, key); it
 * expires through the TTL sweep on `expires_at`. Until the sweep runs, an expired record is invisible
 * to reads and updates and a new reservation takes it over, as once Mongo's TTL monitor removed it.
 */
@Injectable()
export class IdempotencyRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private key(ownerId: string, idempotencyKey: string): SQL {
    return and(eq(r.ownerId, normalizeObjectId(ownerId)), eq(r.idempotencyKey, stripNul(idempotencyKey)))!;
  }

  private live(): SQL {
    return sql`${r.expiresAt} > now()`;
  }

  /**
   * Reserves the key with a fresh record (no execution, no response yet), taking over an expired
   * one. False when a live record already holds the key: the unique (owner_id, idempotency_key)
   * index decides between concurrent callers. Owner ids come from the authenticated user.
   */
  async reserve(input: NewIdempotencyReservation): Promise<boolean> {
    if (!isObjectId(input.ownerId)) throw new Error(`Idempotency owner id is not an ObjectId: ${input.ownerId}`);
    const now = new Date();
    const values = {
      payloadHash: input.payloadHash,
      executionId: null,
      responseBody: null,
      expectedStateHash: null,
      expectedDefinitionRevision: null,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    const rows = await this.q
      .insert(r)
      .values({ id: newObjectId(), ownerId: normalizeObjectId(input.ownerId), idempotencyKey: stripNul(input.idempotencyKey), ...values })
      .onConflictDoUpdate({ target: [r.ownerId, r.idempotencyKey], set: values, setWhere: sql`${r.expiresAt} <= now()` })
      .returning({ id: r.id });
    return rows.length > 0;
  }

  /** The live record holding the key. */
  async findLive(ownerId: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    if (!isObjectId(ownerId)) return null;
    const [row] = await this.q.select().from(r).where(and(this.key(ownerId, idempotencyKey), this.live())).limit(1);
    return row ?? null;
  }

  /** Writes the given fields on the live record. False when there is none. */
  async update(ownerId: string, idempotencyKey: string, patch: IdempotencyRecordPatch): Promise<boolean> {
    if (!isObjectId(ownerId)) return false;
    const rows = await this.q
      .update(r)
      .set({
        executionId: patch.executionId === undefined ? undefined : normalizeObjectId(patch.executionId),
        responseBody: patch.responseBody === undefined ? undefined : stripNul(patch.responseBody),
        expectedStateHash: patch.expectedStateHash,
        expectedDefinitionRevision: patch.expectedDefinitionRevision === undefined ? undefined : Math.trunc(patch.expectedDefinitionRevision),
        updatedAt: new Date(),
      })
      .where(and(this.key(ownerId, idempotencyKey), this.live()))
      .returning({ id: r.id });
    return rows.length > 0;
  }

  /** Removes the record, expired or not. False when there was none. */
  async delete(ownerId: string, idempotencyKey: string): Promise<boolean> {
    if (!isObjectId(ownerId)) return false;
    const rows = await this.q.delete(r).where(this.key(ownerId, idempotencyKey)).returning({ id: r.id });
    return rows.length > 0;
  }
}
