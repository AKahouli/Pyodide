import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { KnowledgeExtractionJobRecord, KnowledgeExtractionJobStatus, KnowledgeExtractionJobType } from '../knowledge-intelligence.types';
import { defined } from './knowledge-sql';

export interface EnqueueKnowledgeExtractionJobInput { programId: string; documentId: string; connectorId: string; requestedByUserId: string; jobType: KnowledgeExtractionJobType; inputHash: string; engineVersion: string }

const MAX_ATTEMPTS = 5;
const LEASE_MS = 300_000;
const EXHAUSTED_MESSAGE = 'The extraction job exhausted its retry limit after a worker lease expired.';

const t = schema.governanceKnowledgeExtractionJobs;
type Row = typeof t.$inferSelect;

function toRecord(row: Row): KnowledgeExtractionJobRecord {
  return defined({
    id: row.id,
    programId: row.programId,
    documentId: row.documentId,
    connectorId: row.connectorId,
    requestedByUserId: row.requestedByUserId,
    jobType: row.jobType as KnowledgeExtractionJobType,
    status: row.status as KnowledgeExtractionJobStatus,
    inputHash: row.inputHash,
    engineVersion: row.engineVersion,
    attempts: row.attempts,
    error: row.error,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    leaseExpiresAt: row.leaseExpiresAt,
    leaseToken: row.leaseToken,
    nextAttemptAt: row.nextAttemptAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) as KnowledgeExtractionJobRecord;
}

/** PostgreSQL governance.knowledge_extraction_jobs queue and leases (roadmap P6). */
@Injectable()
export class KnowledgeExtractionOrchestratorService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Idempotent per (program, document, type, input hash, engine): a repeat returns the existing job untouched. */
  async enqueue(input: EnqueueKnowledgeExtractionJobInput): Promise<KnowledgeExtractionJobRecord> {
    const identity = {
      programId: normalizeObjectId(input.programId),
      documentId: normalizeObjectId(input.documentId),
      jobType: input.jobType,
      inputHash: input.inputHash,
      engineVersion: input.engineVersion,
    };
    const [inserted] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        ...identity,
        connectorId: normalizeObjectId(input.connectorId),
        requestedByUserId: normalizeObjectId(input.requestedByUserId),
        status: 'pending',
        attempts: 0,
      })
      .onConflictDoNothing({ target: [t.programId, t.documentId, t.jobType, t.inputHash, t.engineVersion] })
      .returning();
    if (inserted) return toRecord(inserted);
    const [existing] = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.programId, identity.programId),
        eq(t.documentId, identity.documentId),
        eq(t.jobType, identity.jobType),
        eq(t.inputHash, identity.inputHash),
        eq(t.engineVersion, identity.engineVersion),
      ))
      .limit(1);
    if (!existing) throw new Error('Knowledge extraction job vanished between conflict and read');
    return toRecord(existing);
  }

  /** Re-queues the newest failed job of a document for a connector. */
  async retryLatestFailedForDocument(documentId: string, connectorId: string, requestedByUserId: string): Promise<KnowledgeExtractionJobRecord | null> {
    if (!isObjectId(documentId) || !isObjectId(connectorId) || !isObjectId(requestedByUserId)) return null;
    return withTransaction(this.db, async () => {
      const [latest] = await this.q
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.documentId, normalizeObjectId(documentId)), eq(t.connectorId, normalizeObjectId(connectorId)), eq(t.status, 'failed')))
        .orderBy(desc(t.createdAt))
        .limit(1)
        .for('update');
      if (!latest) return null;
      const [row] = await this.q
        .update(t)
        .set({
          status: 'pending',
          attempts: 0,
          requestedByUserId: normalizeObjectId(requestedByUserId),
          error: null,
          startedAt: null,
          completedAt: null,
          leaseExpiresAt: null,
          leaseToken: null,
          nextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(eq(t.id, latest.id))
        .returning();
      return row ? toRecord(row) : null;
    });
  }

  async markRunning(jobId: string): Promise<KnowledgeExtractionJobRecord | null> {
    if (!isObjectId(jobId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({
        status: 'running',
        attempts: sql`${t.attempts} + 1`,
        startedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        leaseToken: randomUUID(),
        error: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(and(eq(t.id, normalizeObjectId(jobId)), inArray(t.status, ['pending', 'failed'])))
      .returning();
    return row ? toRecord(row) : null;
  }

  /**
   * Claims the oldest runnable job of the given types: pending, failed and due for a retry, or running
   * with an expired lease. Concurrent workers skip rows another one is claiming, so no job is handed out twice.
   * Jobs whose lease expired after the last allowed attempt are failed for good first.
   */
  async claimNext(jobTypes: KnowledgeExtractionJobType[]): Promise<KnowledgeExtractionJobRecord | null> {
    if (!jobTypes.length) return null;
    const now = new Date();
    return withTransaction(this.db, async () => {
      await this.q
        .update(t)
        .set({ status: 'failed', completedAt: now, leaseToken: null, leaseExpiresAt: null, error: EXHAUSTED_MESSAGE, updatedAt: now })
        .where(and(eq(t.status, 'running'), gte(t.attempts, MAX_ATTEMPTS), lte(t.leaseExpiresAt, now)));
      const [candidate] = await this.q
        .select({ id: t.id })
        .from(t)
        .where(and(
          inArray(t.jobType, jobTypes),
          lt(t.attempts, MAX_ATTEMPTS),
          or(
            eq(t.status, 'pending'),
            and(eq(t.status, 'failed'), lte(t.nextAttemptAt, now)),
            and(eq(t.status, 'running'), lte(t.leaseExpiresAt, now)),
          ),
        ))
        .orderBy(asc(t.createdAt), asc(t.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;
      const [row] = await this.q
        .update(t)
        .set({
          status: 'running',
          startedAt: now,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          leaseToken: randomUUID(),
          error: null,
          completedAt: null,
          attempts: sql`${t.attempts} + 1`,
          updatedAt: now,
        })
        .where(eq(t.id, candidate.id))
        .returning();
      return row ? toRecord(row) : null;
    });
  }

  async markCompleted(jobId: string, leaseToken: string): Promise<KnowledgeExtractionJobRecord | null> {
    if (!isObjectId(jobId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({ status: 'completed', completedAt: now, leaseExpiresAt: null, leaseToken: null, error: null, nextAttemptAt: null, updatedAt: now })
      .where(and(eq(t.id, normalizeObjectId(jobId)), eq(t.status, 'running'), eq(t.leaseToken, leaseToken)))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Fails a claimed job and schedules its retry with an exponential back-off capped at 15 minutes. */
  async markFailed(jobId: string, leaseToken: string, error: string, attempts = 1): Promise<KnowledgeExtractionJobRecord | null> {
    if (!isObjectId(jobId)) return null;
    const delay = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({
        status: 'failed',
        completedAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: new Date(now.getTime() + delay),
        error: stripNul(error.slice(0, 2000)),
        updatedAt: now,
      })
      .where(and(eq(t.id, normalizeObjectId(jobId)), eq(t.status, 'running'), eq(t.leaseToken, leaseToken)))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Extends the lease; false when the lease was lost. */
  async heartbeat(jobId: string, leaseToken: string): Promise<boolean> {
    if (!isObjectId(jobId)) return false;
    const now = new Date();
    const rows = await this.q
      .update(t)
      .set({ leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
      .where(and(eq(t.id, normalizeObjectId(jobId)), eq(t.status, 'running'), eq(t.leaseToken, leaseToken)))
      .returning({ id: t.id });
    return rows.length === 1;
  }

  async purgeDocument(documentId: string): Promise<void> {
    if (!isObjectId(documentId)) return;
    await this.q.delete(t).where(eq(t.documentId, normalizeObjectId(documentId)));
  }

  async latestForDocument(documentId: string): Promise<KnowledgeExtractionJobRecord | null> {
    if (!isObjectId(documentId)) return null;
    const [row] = await this.q
      .select()
      .from(t)
      .where(eq(t.documentId, normalizeObjectId(documentId)))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(1);
    return row ? toRecord(row) : null;
  }
}
