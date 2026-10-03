import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
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
} from '@modules/conversation/root-work/root-work.types';

type RootExecutionRow = typeof schema.rootExecutions.$inferSelect;
type RootEvidenceRow = typeof schema.rootEvidenceRecords.$inferSelect;

function toRecord(row: RootExecutionRow): RootExecutionRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    rootAgentId: row.rootAgentId,
    workGroupId: row.workGroupId,
    parentExecutionId: row.parentExecutionId,
    role: row.role as RootExecutionRecord['role'],
    depth: row.depth,
    attempt: row.attempt,
    status: row.status as RootExecutionStatus,
    conversationEpoch: row.conversationEpoch,
    stopRequestId: row.stopRequestId,
    resultPayload: (row.resultPayload as DelegateResultV1 | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    terminalAt: row.terminalAt,
  };
}

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
    const existing = await this.getExecution(input.executionId);
    if (existing) {
      return existing;
    }
    const [row] = await this.db
      .insert(schema.rootExecutions)
      .values({
        id: input.executionId,
        conversationId: input.conversationId,
        rootAgentId: input.rootAgentId,
        workGroupId: input.workGroupId,
        parentExecutionId: input.parentExecutionId,
        role: input.role,
        depth: input.depth,
        attempt: input.attempt,
        status: 'running',
        conversationEpoch: input.conversationEpoch,
      })
      .returning();
    return toRecord(row);
  }

  async getExecution(executionId: string): Promise<RootExecutionRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, executionId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async completeExecution(
    executionId: string,
    status: 'completed' | 'cancelled' | 'failed' | 'outcome_unknown',
    result: RootExecutionRecord['resultPayload'],
  ): Promise<RootExecutionRecord | null> {
    const [row] = await this.db
      .update(schema.rootExecutions)
      .set({
        status,
        resultPayload: result ?? null,
        terminalAt: new Date(),
        updatedAt: new Date(),
      })
      // No-op when already terminal: replayed completion must not resurrect or
      // overwrite a cancellation decided elsewhere.
      .where(
        and(
          eq(schema.rootExecutions.id, executionId),
          inArray(schema.rootExecutions.status, ['running', 'waiting', 'cancellation_requested'] as const),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  async markWaiting(executionId: string): Promise<void> {
    await this.db
      .update(schema.rootExecutions)
      .set({ status: 'waiting', updatedAt: new Date() })
      .where(
        and(eq(schema.rootExecutions.id, executionId), eq(schema.rootExecutions.status, 'running')),
      );
  }

  async registerEvidence(input: RegisterEvidenceInput): Promise<RootEvidenceRecord> {
    const inserted = await this.db
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
    const [existing] = await this.db
      .select()
      .from(schema.rootEvidenceRecords)
      .where(eq(schema.rootEvidenceRecords.dedupKey, input.dedupKey))
      .limit(1);
    return toEvidence(existing);
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
      // Idempotent replay of the same Stop; an older request id arriving after
      // a newer one is ignored so a retried Stop cannot cancel newer work.
      if (conversation.lastStopRequestId === input.stopRequestId) {
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
        .returning({ id: schema.rootExecutions.id });
      await tx.execute(sql`
        UPDATE conversation.conversations
        SET root_work_epoch = ${barrierEpoch}, root_work_last_stop_request_id = ${input.stopRequestId}, updated_at = now()
        WHERE id = ${input.conversationId}::char(24)
      `);
      return { barrierEpoch, applied: true, markedCount: marked.length };
    });
  }
}
