import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { newObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { PlaybookIntentConstructionStatus } from '../interfaces/playbook-flow-intent-construction.interface';

const o = schema.playbookAssistantOperations;
type OperationRow = typeof o.$inferSelect;

export type PlaybookAssistantOperationOrigin = 'designer' | 'mcp' | 'advisor';
export type PlaybookAssistantOperationTarget = 'canonical' | 'advisor_preview';
export type PlaybookAssistantApplyTarget = 'current_playbook' | 'new_playbook';
export type PlaybookAssistantDisposition = 'pending' | 'applying' | 'applied' | 'discarded' | 'reverted';

export type PlaybookAssistantOperationRecord = Omit<
  OperationRow,
  'operationKind' | 'origin' | 'target' | 'applyTarget' | 'disposition' | 'status'
> & {
  operationKind: 'construction' | 'generation';
  origin: PlaybookAssistantOperationOrigin;
  target: PlaybookAssistantOperationTarget;
  applyTarget: PlaybookAssistantApplyTarget;
  disposition: PlaybookAssistantDisposition;
  status: PlaybookIntentConstructionStatus;
};

/** An operation is always addressed by its id together with the Playbook and owner it belongs to. */
export interface PlaybookAssistantOperationKey {
  operationId: string;
  playbookId: string;
  ownerId: string;
}

export interface NewPlaybookAssistantOperation extends PlaybookAssistantOperationKey {
  baseDefinitionRevision: number;
  origin: PlaybookAssistantOperationOrigin;
  target: PlaybookAssistantOperationTarget;
  applyTarget: PlaybookAssistantApplyTarget;
  requestId: string | null;
  operationKind: 'construction' | 'generation';
  createdPlaybookId: string | null;
  workerId: string;
  leaseExpiresAt: Date;
  expiresAt: Date;
}

/** An operation whose worker lease ran out while it was queued or running. */
export type OrphanedPlaybookAssistantOperation = PlaybookAssistantOperationKey & { lastSequence: number };

const ACTIVE_STATUSES = ['queued', 'running'];
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

export function toAssistantOperationRecord(row: OperationRow): PlaybookAssistantOperationRecord {
  return row as PlaybookAssistantOperationRecord;
}

/**
 * PostgreSQL playbook.assistant_operations repository (roadmap P5): the construction event log of
 * an assistant operation, its worker lease and what became of its result. Every transition is one
 * conditional UPDATE. Rows expire through the TTL sweep on `expires_at`; until the sweep runs an
 * expired row is invisible here, as it was once Mongo's TTL monitor removed it.
 */
@Injectable()
export class PlaybookAssistantOperationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private live(): SQL {
    return sql`${o.expiresAt} > now()`;
  }

  private byKey(key: PlaybookAssistantOperationKey): SQL {
    return and(eq(o.operationId, key.operationId), eq(o.playbookId, key.playbookId), eq(o.ownerId, key.ownerId), this.live()) as SQL;
  }

  /** Lease ran out (or was never set) at `cutoff`. */
  private leaseLapsed(cutoff: Date): SQL {
    return or(lte(o.leaseExpiresAt, cutoff), isNull(o.leaseExpiresAt)) as SQL;
  }

  async insert(input: NewPlaybookAssistantOperation): Promise<PlaybookAssistantOperationRecord> {
    const [row] = await this.q
      .insert(o)
      .values({ id: newObjectId(), ...input, disposition: 'pending', status: 'queued', lastSequence: 0, events: [], eventBytes: 0 })
      .returning();
    return toAssistantOperationRecord(row);
  }

  async find(key: PlaybookAssistantOperationKey): Promise<PlaybookAssistantOperationRecord | null> {
    const [row] = await this.q.select().from(o).where(this.byKey(key)).limit(1);
    return row ? toAssistantOperationRecord(row) : null;
  }

  async findOrphaned(cutoff: Date): Promise<OrphanedPlaybookAssistantOperation[]> {
    return this.q
      .select({ operationId: o.operationId, playbookId: o.playbookId, ownerId: o.ownerId, lastSequence: o.lastSequence })
      .from(o)
      .where(and(inArray(o.status, ACTIVE_STATUSES), this.leaseLapsed(cutoff), this.live()));
  }

  /** The SET of an event append: push the event, bump the sequence and the byte count. */
  private appendSet(event: Record<string, unknown>, eventBytes: number): PgUpdateSetSource<typeof o> {
    return {
      events: sql`${o.events} || jsonb_build_array(${JSON.stringify(stripNul(event))}::jsonb)`,
      lastSequence: sql`${o.lastSequence} + 1`,
      eventBytes: sql`${o.eventBytes} + ${eventBytes}`,
      updatedAt: new Date(),
    };
  }

  /**
   * Appends `event` as sequence `expectedSequence + 1` of a non-terminal operation. With `workerId`,
   * only that worker may append and only while its lease runs. False when the sequence moved, the
   * operation turned terminal or the lease was lost: nothing is written.
   */
  async appendEvent(key: PlaybookAssistantOperationKey, input: {
    expectedSequence: number;
    event: Record<string, unknown>;
    eventBytes: number;
    status: PlaybookIntentConstructionStatus | null;
    terminal: boolean;
    leaseExpiresAt: Date | null;
    expiresAt: Date;
    workerId?: string;
  }): Promise<boolean> {
    const rows = await this.q
      .update(o)
      .set({
        ...this.appendSet(input.event, input.eventBytes),
        ...(input.status ? { status: input.status } : {}),
        ...(input.terminal ? { terminalAt: new Date() } : {}),
        leaseExpiresAt: input.leaseExpiresAt,
        expiresAt: input.expiresAt,
      })
      .where(and(
        this.byKey(key),
        eq(o.lastSequence, input.expectedSequence),
        notInArray(o.status, TERMINAL_STATUSES),
        input.workerId === undefined ? undefined : and(eq(o.workerId, input.workerId), sql`${o.leaseExpiresAt} > now()`),
      ))
      .returning({ id: o.id });
    return rows.length > 0;
  }

  /** Fails an operation whose lease lapsed at `cutoff`, appending `event`. False when it moved on meanwhile. */
  async failOrphaned(key: PlaybookAssistantOperationKey, input: {
    expectedSequence: number;
    cutoff: Date;
    event: Record<string, unknown>;
    eventBytes: number;
    expiresAt: Date;
  }): Promise<boolean> {
    const rows = await this.q
      .update(o)
      .set({ ...this.appendSet(input.event, input.eventBytes), status: 'failed', terminalAt: new Date(), leaseExpiresAt: null, expiresAt: input.expiresAt })
      .where(and(this.byKey(key), eq(o.lastSequence, input.expectedSequence), inArray(o.status, ACTIVE_STATUSES), this.leaseLapsed(input.cutoff)))
      .returning({ id: o.id });
    return rows.length > 0;
  }

  /** Extends the lease of `workerId` from the database clock; false once the lease was lost. */
  async renewLease(key: PlaybookAssistantOperationKey, workerId: string, leaseMs: number, retentionMs: number): Promise<boolean> {
    const rows = await this.q
      .update(o)
      .set({
        leaseExpiresAt: sql`now() + ${leaseMs}::double precision * interval '1 millisecond'`,
        expiresAt: sql`now() + ${retentionMs}::double precision * interval '1 millisecond'`,
        updatedAt: new Date(),
      })
      .where(and(this.byKey(key), eq(o.workerId, workerId), inArray(o.status, ACTIVE_STATUSES), sql`${o.leaseExpiresAt} > now()`))
      .returning({ id: o.id });
    return rows.length > 0;
  }

  private async transition(key: PlaybookAssistantOperationKey, guard: Array<SQL | undefined>, set: PgUpdateSetSource<typeof o>): Promise<boolean> {
    const rows = await this.q
      .update(o)
      .set({ ...set, updatedAt: new Date() })
      .where(and(this.byKey(key), ...guard))
      .returning({ id: o.id });
    return rows.length > 0;
  }

  /** A pending (or already discarded) preview is discarded. */
  async discard(key: PlaybookAssistantOperationKey, expiresAt: Date): Promise<boolean> {
    return this.transition(key, [inArray(o.disposition, ['pending', 'discarded'])], { disposition: 'discarded', expiresAt });
  }

  /** Claims the apply of a completed, pending operation: exactly one caller wins. */
  async claimApply(key: PlaybookAssistantOperationKey, expiresAt: Date): Promise<boolean> {
    return this.transition(key, [eq(o.status, 'completed'), eq(o.disposition, 'pending')], { disposition: 'applying', expiresAt });
  }

  /** Gives an apply claim back after the apply failed. */
  async releaseApply(key: PlaybookAssistantOperationKey, expiresAt: Date): Promise<boolean> {
    return this.transition(key, [eq(o.disposition, 'applying')], { disposition: 'pending', expiresAt });
  }

  /** Records a canonical/preview commit of an operation in `status`. */
  async markApplied(key: PlaybookAssistantOperationKey, input: { status: PlaybookIntentConstructionStatus; committedRevision: number; expiresAt: Date }): Promise<boolean> {
    return this.transition(key, [eq(o.status, input.status)], {
      disposition: 'applied',
      committedRevision: input.committedRevision,
      committedAt: new Date(),
      expiresAt: input.expiresAt,
    });
  }

  /** Records the Playbook a claimed generate-new apply created. */
  async recordCreatedPlaybook(key: PlaybookAssistantOperationKey, input: { createdPlaybookId: string; committedRevision: number; expiresAt: Date }): Promise<boolean> {
    return this.transition(key, [eq(o.status, 'completed'), eq(o.disposition, 'applying')], {
      disposition: 'applied',
      committedRevision: input.committedRevision,
      committedAt: new Date(),
      createdPlaybookId: input.createdPlaybookId,
      expiresAt: input.expiresAt,
    });
  }

  /** Marks the operation reverted, from `committedRevision` only when given. */
  async markReverted(key: PlaybookAssistantOperationKey, input: { revertedRevision: number; committedRevision?: number; expiresAt: Date }): Promise<boolean> {
    return this.transition(
      key,
      [ne(o.disposition, 'reverted'), input.committedRevision === undefined ? undefined : eq(o.committedRevision, input.committedRevision)],
      { disposition: 'reverted', revertedRevision: input.revertedRevision, revertedAt: new Date(), expiresAt: input.expiresAt },
    );
  }
}
