import { Inject, Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { admitRootExecution, toRecord } from './root-execution-admission';
import { LoggerService } from '@modules/logger';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import {
  RegisterEvidenceInput,
  RegisterExecutionInput,
  RootWorkStore,
  StopRootWorkInput,
  StopRootWorkResult,
} from '@modules/conversation/root-work/root-work.store';
import {
  DelegateResultV1,
  RootEvidenceRecord,
  RootExecutionRecord,
  RootExecutionStatus,
  RootNativeState,
  RootBackgroundJobOwnerV1,
} from '@modules/conversation/root-work/root-work.types';
import { requireBackgroundOwner } from './root-background-owner';
import { requireBackgroundItemOwner } from './root-background-fanout';

type RootExecutionRow = typeof schema.rootExecutions.$inferSelect;
type RootEvidenceRow = typeof schema.rootEvidenceRecords.$inferSelect;

function toEvidence(row: RootEvidenceRow): RootEvidenceRecord {
  return {
    id: row.id,
    executionId: row.executionId,
    conversationId: row.conversationId,
    kind: row.kind as RootEvidenceRecord['kind'],
    producerAgentId: row.producerAgentId,
    payload: (row.payload as Record<string, unknown>) ?? {},
    dedupKey: row.dedupKey,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PostgresRootWorkStore implements RootWorkStore {
  private unavailable = false;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PostgresRootWorkStore.name);
  }

  async registerExecution(input: RegisterExecutionInput): Promise<RootExecutionRecord> {
    return this.db.transaction((tx) => admitRootExecution(tx, input));
  }

  async getExecution(executionId: string): Promise<RootExecutionRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, executionId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async listWaitingRoots(conversationId: string, epoch: number): Promise<RootExecutionRecord[]> {
    const rows = await this.db.select().from(schema.rootExecutions).where(and(
      eq(schema.rootExecutions.conversationId, conversationId), eq(schema.rootExecutions.conversationEpoch, epoch),
      eq(schema.rootExecutions.role, 'root'), eq(schema.rootExecutions.status, 'waiting'),
    )).limit(10);
    return rows.map(toRecord);
  }

  async completeExecution(
    executionId: string,
    status: 'completed' | 'cancelled' | 'failed' | 'outcome_unknown',
    result: RootExecutionRecord['resultPayload'],
    evidence: RegisterEvidenceInput[] = [],
    backgroundOwner?: RootBackgroundJobOwnerV1,
  ): Promise<RootExecutionRecord | null> {
    return this.db.transaction(async (tx) => {
    let [execution] = await tx.select().from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, executionId)).limit(1);
    if (!execution) return null;
    // Same lock ordering as Stop: conversation first, then execution update.
    const [conversation] = await tx.select({ epoch: schema.conversations.rootWorkEpoch })
      .from(schema.conversations).where(eq(schema.conversations.id, execution.conversationId))
      .limit(1).for('update');
    if (!conversation || (status === 'completed' && conversation.epoch !== execution.conversationEpoch)) return null;
    [execution] = await tx.select().from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, executionId)).limit(1).for('update');
    if (!execution) return null;
    if (!['running', 'waiting', ...(status === 'completed' ? [] : ['cancellation_requested'])].includes(execution.status)) return null;
    const background = (execution.resultPayload as DelegateResultV1 | null)?.nativeState?.backgroundJobId;
    const stoppedCancellation = status === 'cancelled' && execution.status === 'cancellation_requested'
      && conversation.epoch > execution.conversationEpoch;
    const fanoutItem = (execution.resultPayload as DelegateResultV1 | null)?.nativeState?.backgroundFanoutItem;
    if (fanoutItem && !stoppedCancellation) await requireBackgroundItemOwner(tx, execution, backgroundOwner);
    if (background && !stoppedCancellation) await requireBackgroundOwner(tx, toRecord(execution), backgroundOwner);
    if (evidence.length) {
      if (status !== 'completed' || !['library_worker', 'temporary_worker'].includes(execution.role)) {
        throw new Error('Evidence requires completed library worker settlement');
      }
      for (const item of evidence) {
        if (item.executionId !== execution.id || item.conversationId !== execution.conversationId) {
          throw new Error('Evidence producer does not match settlement');
        }
        await tx.insert(schema.rootEvidenceRecords).values({ id: item.evidenceId,
          executionId: item.executionId, conversationId: item.conversationId,
          kind: item.kind, producerAgentId: item.producerAgentId, payload: item.payload,
          dedupKey: item.dedupKey }).onConflictDoNothing({ target: schema.rootEvidenceRecords.dedupKey });
        const [registered] = await tx.select().from(schema.rootEvidenceRecords)
          .where(eq(schema.rootEvidenceRecords.dedupKey, item.dedupKey)).limit(1);
        if (!registered || registered.id !== item.evidenceId || registered.kind !== item.kind
          || !isDeepStrictEqual(registered.payload, item.payload)) {
          throw new Error('Evidence replay conflicts with its immutable producer');
        }
      }
    }
    const [row] = await tx
      .update(schema.rootExecutions)
      .set({
        status,
        resultPayload: result ? { ...result, nativeState: (execution.resultPayload as DelegateResultV1)?.nativeState }
          : execution.resultPayload ? { ...(execution.resultPayload as DelegateResultV1), status } : null,
        terminalAt: new Date(),
        updatedAt: new Date(),
      })
      // No-op when already terminal: replayed completion must not resurrect or
      // overwrite a cancellation decided elsewhere.
      .where(
        and(
          eq(schema.rootExecutions.id, executionId),
          inArray(schema.rootExecutions.status, status === 'completed'
            ? ['running', 'waiting'] : ['running', 'waiting', 'cancellation_requested']),
        ),
      )
      .returning();
    if (row && background && !stoppedCancellation) {
      const settled = await tx.update(schema.rootBackgroundJobs).set({ status, owner: null, leaseUntil: null, updatedAt: new Date() })
        .where(and(eq(schema.rootBackgroundJobs.executionId, executionId),
          eq(schema.rootBackgroundJobs.owner, backgroundOwner!.owner), eq(schema.rootBackgroundJobs.fence, backgroundOwner!.fence),
          eq(schema.rootBackgroundJobs.status, 'running'), sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`,
          sql`${schema.rootBackgroundJobs.deadline} > clock_timestamp()`)).returning({ id: schema.rootBackgroundJobs.executionId });
      if (settled.length !== 1) throw new Error('Background lease expired before atomic settlement');
    }
    if (row && fanoutItem && !stoppedCancellation) await requireBackgroundItemOwner(tx, row, backgroundOwner);
    return row ? toRecord(row) : null;
    });
  }

  async markWaiting(executionId: string): Promise<void> {
    await this.db
      .update(schema.rootExecutions)
      .set({ status: 'waiting', updatedAt: new Date() })
      .where(
        and(eq(schema.rootExecutions.id, executionId), eq(schema.rootExecutions.status, 'running'),
          sql`${schema.rootExecutions.resultPayload}->'nativeState'->>'backgroundJobId' IS NULL`,
          sql`${schema.rootExecutions.resultPayload}->'nativeState'->>'backgroundFanoutItem' IS NULL`),
      );
  }

  async recordNativeState(executionId: string, state: RootNativeState,
    status: 'running' | 'waiting', backgroundOwner?: RootBackgroundJobOwnerV1): Promise<RootExecutionRecord | null> {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx.select({ conversationId: schema.rootExecutions.conversationId }).from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, executionId)).limit(1);
      if (!identity) return null;
      const [ownerConversation] = await tx.select({ epoch: schema.conversations.rootWorkEpoch })
        .from(schema.conversations).where(eq(schema.conversations.id, identity.conversationId))
        .limit(1).for('update');
      const [execution] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, executionId)).limit(1).for('update');
      if (!execution || !ownerConversation || ownerConversation.epoch !== execution.conversationEpoch) return null;
      if (!['running', 'waiting'].includes(execution.status)) return null;
      const payload = execution.resultPayload as DelegateResultV1 | null;
      const previous = payload?.nativeState;
      const itemJob = previous?.backgroundFanoutItem ? await requireBackgroundItemOwner(tx, execution, backgroundOwner) : null;
      const job = previous?.backgroundJobId ? await requireBackgroundOwner(tx, toRecord(execution), backgroundOwner) : null;
      const ownedJob = job ?? itemJob;
      if (ownedJob && (ownedJob.nativeInvocationId !== state.invocationId || !state.invocationId)) {
        throw new Error('Background native mapping must match committed invocation correlation');
      }
      if (!previous || previous.actorId !== state.actorId || previous.sessionId !== state.sessionId
        || previous.invocationId && previous.invocationId !== state.invocationId) {
        throw new Error('Native invocation mapping conflicts with its execution');
      }
      const [row] = await tx.update(schema.rootExecutions).set({
        status, resultPayload: { ...payload, nativeState: { ...state,
          fanoutManifests: previous.fanoutManifests, workerPermits: previous.workerPermits,
          admittedRequest: previous.admittedRequest,
          backgroundEventSequence: previous.backgroundEventSequence,
          backgroundJobId: previous.backgroundJobId, backgroundFanout: previous.backgroundFanout,
          backgroundFanoutItem: previous.backgroundFanoutItem,
          hasBackgroundJobs: previous.hasBackgroundJobs } }, updatedAt: new Date(),
      }).where(and(eq(schema.rootExecutions.id, executionId),
        inArray(schema.rootExecutions.status, ['running', 'waiting']))).returning();
      if (row && job) {
        const parked = await tx.update(schema.rootBackgroundJobs).set(status === 'waiting'
          ? { status: 'waiting', owner: null, leaseUntil: null, updatedAt: new Date() }
          : { updatedAt: new Date() })
          .where(and(eq(schema.rootBackgroundJobs.executionId, executionId),
            eq(schema.rootBackgroundJobs.owner, backgroundOwner!.owner), eq(schema.rootBackgroundJobs.fence, backgroundOwner!.fence),
            eq(schema.rootBackgroundJobs.status, 'running'),
            sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`,
            sql`${schema.rootBackgroundJobs.deadline} > clock_timestamp()`)).returning({ id: schema.rootBackgroundJobs.executionId });
        if (parked.length !== 1) throw new Error('Background lease expired before native state commit');
      }
      if (row && itemJob) await requireBackgroundItemOwner(tx, row, backgroundOwner);
      return row ? toRecord(row) : null;
    });
  }

  async registerEvidence(input: RegisterEvidenceInput): Promise<RootEvidenceRecord> {
    return this.db.transaction(async (tx) => {
    const [conversation] = await tx.select({ id: schema.conversations.id }).from(schema.conversations)
      .where(eq(schema.conversations.id, input.conversationId)).limit(1).for('update');
    const [execution] = await tx.select().from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, input.executionId)).limit(1).for('update');
    if (!conversation || !execution || execution.conversationId !== input.conversationId
      || (execution.resultPayload as DelegateResultV1 | null)?.nativeState?.backgroundJobId
      || (execution.resultPayload as DelegateResultV1 | null)?.nativeState?.backgroundFanoutItem) {
      throw new Error('Background evidence requires atomic owned settlement');
    }
    const inserted = await tx
      .insert(schema.rootEvidenceRecords)
      .values({
        id: input.evidenceId,
        executionId: input.executionId,
        conversationId: input.conversationId,
        kind: input.kind,
        producerAgentId: input.producerAgentId,
        payload: input.payload,
        dedupKey: input.dedupKey,
      })
      .onConflictDoNothing({ target: schema.rootEvidenceRecords.dedupKey })
      .returning();
    if (inserted.length > 0) {
      return toEvidence(inserted[0]);
    }
    // Replay: the dedup key exists — return the registered identity unchanged.
    const [existing] = await tx
      .select()
      .from(schema.rootEvidenceRecords)
      .where(eq(schema.rootEvidenceRecords.dedupKey, input.dedupKey))
      .limit(1);
    return toEvidence(existing);
    });
  }

  async listEvidenceForExecution(executionId: string): Promise<RootEvidenceRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.rootEvidenceRecords)
      .where(eq(schema.rootEvidenceRecords.executionId, executionId));
    return rows.map(toEvidence);
  }

  async stopRootWork(input: StopRootWorkInput): Promise<StopRootWorkResult> {
    return this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({
          epoch: schema.conversations.rootWorkEpoch,
          lastStopRequestId: schema.conversations.rootWorkLastStopRequestId,
        })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .limit(1)
        .for('update');
      if (!conversation) {
        throw new Error(`conversation ${input.conversationId} not found`);
      }
      // Stop ids are UUIDv7 (time-ordered, see newStopRequestId), so
      // lexicographic order is chronological. Equal id = idempotent replay;
      // a smaller id arriving after a newer one is a stale/retried Stop and
      // is ignored so it cannot cancel work admitted under the newer barrier.
      if (
        conversation.lastStopRequestId !== null &&
        conversation.lastStopRequestId >= input.stopRequestId
      ) {
        return { barrierEpoch: conversation.epoch, applied: false, markedCount: 0 };
      }
      const barrierEpoch = conversation.epoch + 1;
      const marked = await tx
        .update(schema.rootExecutions)
        .set({ status: 'cancellation_requested', stopRequestId: input.stopRequestId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.rootExecutions.conversationId, input.conversationId),
            lte(schema.rootExecutions.conversationEpoch, conversation.epoch),
            inArray(schema.rootExecutions.status, ['running', 'waiting'] as const),
          ),
        )
        .returning({ id: schema.rootExecutions.id, resultPayload: schema.rootExecutions.resultPayload });
      const [backgroundRoot] = await tx.select({ id: schema.rootExecutions.id }).from(schema.rootExecutions).where(and(
        eq(schema.rootExecutions.conversationId, input.conversationId), lte(schema.rootExecutions.conversationEpoch, conversation.epoch),
        sql`${schema.rootExecutions.resultPayload}->'nativeState'->>'hasBackgroundJobs' = 'true'`)).limit(1);
      if (backgroundRoot || marked.some((execution) => (execution.resultPayload as DelegateResultV1 | null)?.nativeState?.backgroundJobId)) {
        await tx.update(schema.rootBackgroundJobs).set({ status: 'cancelled', owner: null, leaseUntil: null,
          fence: sql`${schema.rootBackgroundJobs.fence} + 1`, updatedAt: new Date() }).where(and(
          eq(schema.rootBackgroundJobs.conversationId, input.conversationId),
          lte(schema.rootBackgroundJobs.conversationEpoch, conversation.epoch),
          inArray(schema.rootBackgroundJobs.status, ['queued', 'running', 'waiting', 'outcome_unknown'])));
      }
      await tx.execute(sql`
        UPDATE conversation.conversations
        SET root_work_epoch = ${barrierEpoch}, root_work_last_stop_request_id = ${input.stopRequestId}, updated_at = now()
        WHERE id = ${input.conversationId}::char(24)
      `);
      return { barrierEpoch, applied: true, markedCount: marked.length };
    });
  }
}
