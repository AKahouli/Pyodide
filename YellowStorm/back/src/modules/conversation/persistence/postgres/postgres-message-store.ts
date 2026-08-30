import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  MessageComponent,
  ResponseCorrectionAttempt,
} from '../../interfaces/message.interface';
import { newOwnedId } from '../owned-id';
import type {
  AiMessageComponentsRecord,
  MessagePageInput,
  MessageRecord,
  MessageStore,
  ReportMessageRecord,
} from '../message-store';
import { mapPostgresMessage } from './postgres-message-record.mapper';

@Injectable()
export class PostgresMessageStore implements MessageStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async createUser(input: Parameters<MessageStore['createUser']>[0]): Promise<MessageRecord> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(schema.messages)
        .values({
          id: newOwnedId(),
          conversationId: input.conversationId,
          senderId: input.senderId,
          parentMessageId: input.parentMessageId,
          conversationType: 'user',
          content: input.content,
          attachedFileIds: input.attachedFileIds,
          webSearchEnabled: input.webSearchEnabled ?? false,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          agentIds: input.agentIds,
          memberIds: input.memberIds,
          isStreaming: false,
          isComplete: true,
          requestId: input.requestId,
          interaction: input.interaction,
          interactions: input.interactions,
          replayContext: input.replayContext,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx
        .update(schema.conversations)
        .set({
          lastMessageAt: now,
          messageCount: sql`${schema.conversations.messageCount} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.conversations.id, input.conversationId));
      return mapPostgresMessage(row);
    });
  }

  async createAiPlaceholder(
    input: Parameters<MessageStore['createAiPlaceholder']>[0],
  ): Promise<MessageRecord> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const id = newOwnedId();
      const [row] = await tx
        .insert(schema.messages)
        .values({
          id,
          conversationId: input.conversationId,
          conversationType: 'ai',
          senderId: input.senderId,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          questionMessageId: input.questionMessageId,
          isStreaming: true,
          isComplete: false,
          components: [],
          requestId: input.requestId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx
        .update(schema.messages)
        .set({ answerMessageId: id, updatedAt: now })
        .where(
          and(
            eq(schema.messages.id, input.questionMessageId),
            isNull(schema.messages.answerMessageId),
          ),
        );
      return mapPostgresMessage(row);
    });
  }

  async completeAi(
    input: Parameters<MessageStore['completeAi']>[0],
  ): Promise<MessageRecord | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const conditions = [
        eq(schema.messages.id, input.messageId),
        eq(schema.messages.conversationType, 'ai'),
        eq(schema.messages.isComplete, false),
      ];
      if (input.streamExecutionLeaseId) {
        conditions.push(eq(schema.messages.streamExecutionLeaseId, input.streamExecutionLeaseId));
      }
      const [row] = await tx
        .update(schema.messages)
        .set({
          components: input.components,
          isStreaming: false,
          isComplete: true,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          durationMs: input.durationMs,
          timeToFirstChunk: input.timeToFirstChunk,
          timeToFirstToken: input.timeToFirstToken,
          modelRequestTelemetry: input.modelRequestTelemetry,
          guardrailDecision: input.guardrailDecision,
          updatedAt: now,
        })
        .where(and(...conditions))
        .returning();
      if (!row) return null;
      await tx
        .update(schema.conversations)
        .set({
          lastMessageAt: now,
          messageCount: sql`${schema.conversations.messageCount} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.conversations.id, row.conversationId));
      return mapPostgresMessage(row);
    });
  }

  async findById(id: string): Promise<MessageRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, id))
      .limit(1);
    return row ? mapPostgresMessage(row) : null;
  }

  async listPage(input: MessagePageInput): Promise<{ records: MessageRecord[]; total: number }> {
    const where = input.conversationType
      ? and(
          eq(schema.messages.conversationId, input.conversationId),
          eq(schema.messages.conversationType, input.conversationType),
        )
      : eq(schema.messages.conversationId, input.conversationId);
    const [rows, count] = await Promise.all([
      this.db
        .select()
        .from(schema.messages)
        .where(where)
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(where),
    ]);
    return {
      records: rows.reverse().map(mapPostgresMessage),
      total: count[0]?.count ?? 0,
    };
  }

  async listByConversation(conversationId: string): Promise<MessageRecord[]> {
    return (
      await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    ).map(mapPostgresMessage);
  }

  async findTurnByRequestId(
    conversationId: string,
    senderId: string,
    requestId: string,
  ): Promise<{ user: MessageRecord; aiId?: string } | null> {
    const [user] = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.senderId, senderId),
          eq(schema.messages.conversationType, 'user'),
          eq(schema.messages.requestId, requestId),
        ),
      )
      .limit(1);
    if (!user) return null;
    const [ai] = await this.db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.senderId, senderId),
          eq(schema.messages.conversationType, 'ai'),
          eq(schema.messages.questionMessageId, user.id),
          eq(schema.messages.requestId, requestId),
        ),
      )
      .limit(1);
    return { user: mapPostgresMessage(user), aiId: ai?.id.trim() };
  }

  async updateFeedback(id: string, feedback: MessageRecord['feedback'], feedbackAt: Date) {
    return this.update(id, { feedback, feedbackAt });
  }

  async updateReliability(
    id: string,
    evaluation: NonNullable<MessageRecord['reliabilityEvaluation']>,
  ) {
    return this.update(id, {
      reliabilityEvaluation: evaluation,
      reliabilityEvaluationHeartbeatAt: evaluation.status === 'pending' ? new Date() : null,
    });
  }

  async claimStream(id: string, leaseId: string, now: Date, expiresAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(schema.messages)
      .set({
        streamExecutionLeaseId: leaseId,
        streamExecutionLeaseExpiresAt: expiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.messages.id, id),
          eq(schema.messages.conversationType, 'ai'),
          eq(schema.messages.isComplete, false),
          or(
            isNull(schema.messages.streamExecutionLeaseExpiresAt),
            lte(schema.messages.streamExecutionLeaseExpiresAt, now),
          ),
        ),
      )
      .returning({ id: schema.messages.id });
    return rows.length === 1;
  }

  async renewStream(id: string, leaseId: string, expiresAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(schema.messages)
      .set({ streamExecutionLeaseExpiresAt: expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(schema.messages.id, id),
          eq(schema.messages.streamExecutionLeaseId, leaseId),
          eq(schema.messages.isComplete, false),
        ),
      )
      .returning({ id: schema.messages.id });
    return rows.length === 1;
  }

  async releaseStream(id: string, leaseId: string): Promise<void> {
    await this.db
      .update(schema.messages)
      .set({
        streamExecutionLeaseId: null,
        streamExecutionLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.messages.id, id), eq(schema.messages.streamExecutionLeaseId, leaseId)));
  }

  async claimReliability(
    conversationId: string,
    id: string,
    manual: boolean,
    requestedAt: string,
  ): Promise<MessageRecord | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.messages)
        .where(and(eq(schema.messages.id, id), eq(schema.messages.conversationId, conversationId)))
        .for('update')
        .limit(1);
      if (!row) return null;
      const record = mapPostgresMessage(row);
      const components = record.components ?? [];
      const hasAnswer =
        record.conversationType === 'ai' &&
        record.isComplete &&
        !record.isStreaming &&
        Boolean(record.questionMessageId) &&
        components.some(
          (component) =>
            component.type === 'text' &&
            typeof component.data?.content === 'string' &&
            component.data.content.trim(),
        ) &&
        !components.some((component) => component.type === 'error');
      const correctionInProgress = ['queued', 'correcting', 're_evaluating'].includes(
        record.correctionWorkflow?.status ?? '',
      );
      if (
        !hasAnswer ||
        correctionInProgress ||
        (manual
          ? record.reliabilityEvaluation?.status === 'pending'
          : record.reliabilityEvaluation !== undefined)
      ) {
        return null;
      }
      const [claimed] = await tx
        .update(schema.messages)
        .set({
          reliabilityEvaluation: { status: 'pending', requestedAt },
          reliabilityEvaluationHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.messages.id, id))
        .returning();
      return mapPostgresMessage(claimed);
    });
  }

  async updateCorrectionWorkflow(
    id: string,
    workflow: NonNullable<MessageRecord['correctionWorkflow']>,
    correctionRunId?: string,
  ): Promise<MessageRecord | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, id))
        .for('update')
        .limit(1);
      if (!row || row.conversationType !== 'ai') return null;
      const current = row.correctionWorkflow as MessageRecord['correctionWorkflow'];
      if (correctionRunId && current?.correctionRunId !== correctionRunId) return null;
      const next = { ...current, ...workflow, attempts: workflow.attempts ?? current?.attempts };
      const [updated] = await tx
        .update(schema.messages)
        .set({ correctionWorkflow: next, updatedAt: new Date() })
        .where(eq(schema.messages.id, id))
        .returning();
      return mapPostgresMessage(updated);
    });
  }

  async claimCorrectionRun(
    id: string,
    runId: string,
    leaseExpiresAt: string,
    now: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, id))
        .for('update')
        .limit(1);
      if (!row || row.conversationType !== 'ai') return false;
      const record = mapPostgresMessage(row);
      const workflow = record.correctionWorkflow;
      const terminal = ['corrected', 'failed', 'abstained', 'human_review_required'].includes(
        workflow?.status ?? '',
      );
      if (
        record.reliabilityEvaluation?.status === 'pending' ||
        (workflow?.correctionRunId &&
          !terminal &&
          !(workflow.leaseExpiresAt && workflow.leaseExpiresAt < now))
      ) {
        return false;
      }
      const next = {
        ...workflow,
        correctionRunId: runId,
        leaseExpiresAt,
        status: 'queued' as const,
        activeVersion: 'original' as const,
      } as NonNullable<MessageRecord['correctionWorkflow']>;
      await tx
        .update(schema.messages)
        .set({ correctionWorkflow: next, updatedAt: new Date() })
        .where(eq(schema.messages.id, id));
      return true;
    });
  }

  async upsertCorrectionAttempt(
    id: string,
    attempt: ResponseCorrectionAttempt,
    correctionRunId?: string,
  ): Promise<MessageRecord | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, id))
        .for('update')
        .limit(1);
      if (!row || row.conversationType !== 'ai') return null;
      const workflow = row.correctionWorkflow as MessageRecord['correctionWorkflow'];
      if (!workflow || (correctionRunId && workflow.correctionRunId !== correctionRunId))
        return null;
      const attempts = [...(workflow.attempts ?? [])];
      const index = attempts.findIndex((item) => item.attemptId === attempt.attemptId);
      if (index < 0) attempts.push(attempt);
      else if (!['accepted', 'rejected', 'failed'].includes(attempts[index].status)) {
        attempts[index] = { ...attempts[index], ...attempt };
      }
      const [updated] = await tx
        .update(schema.messages)
        .set({ correctionWorkflow: { ...workflow, attempts }, updatedAt: new Date() })
        .where(eq(schema.messages.id, id))
        .returning();
      return mapPostgresMessage(updated);
    });
  }

  async failStaleReliability(cutoff: Date): Promise<MessageRecord[]> {
    const candidates = await this.db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          sql`${schema.messages.reliabilityEvaluation}->>'status' = 'pending'`,
          or(
            lt(schema.messages.reliabilityEvaluationHeartbeatAt, cutoff),
            and(
              isNull(schema.messages.reliabilityEvaluationHeartbeatAt),
              sql`(${schema.messages.reliabilityEvaluation}->>'requestedAt')::timestamptz < ${cutoff}`,
            ),
          ),
        ),
      );
    const updated: MessageRecord[] = [];
    for (const candidate of candidates) {
      const [row] = await this.db
        .update(schema.messages)
        .set({
          reliabilityEvaluation: sql`jsonb_set(jsonb_set(${schema.messages.reliabilityEvaluation}, '{status}', '"failed"'), '{failureCode}', '"stale_pending_after_restart"') || jsonb_build_object('evaluatedAt', ${new Date().toISOString()})`,
          reliabilityEvaluationHeartbeatAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.messages.id, candidate.id),
            sql`${schema.messages.reliabilityEvaluation}->>'status' = 'pending'`,
            or(
              lt(schema.messages.reliabilityEvaluationHeartbeatAt, cutoff),
              and(
                isNull(schema.messages.reliabilityEvaluationHeartbeatAt),
                sql`(${schema.messages.reliabilityEvaluation}->>'requestedAt')::timestamptz < ${cutoff}`,
              ),
            ),
          ),
        )
        .returning();
      if (row) updated.push(mapPostgresMessage(row));
    }
    return updated;
  }

  async touchPendingReliability(ids: string[], now: Date): Promise<void> {
    if (!ids.length) return;
    await this.db
      .update(schema.messages)
      .set({ reliabilityEvaluationHeartbeatAt: now, updatedAt: now })
      .where(
        and(
          inArray(schema.messages.id, ids),
          sql`${schema.messages.reliabilityEvaluation}->>'status' = 'pending'`,
        ),
      );
  }

  async markStreamFailed(id: string, leaseId?: string): Promise<void> {
    const conditions = [eq(schema.messages.id, id), eq(schema.messages.isComplete, false)];
    if (leaseId) conditions.push(eq(schema.messages.streamExecutionLeaseId, leaseId));
    await this.db
      .update(schema.messages)
      .set({ isStreaming: false, isComplete: false, updatedAt: new Date() })
      .where(and(...conditions));
  }

  async cleanupStaleStreams(cutoff: Date): Promise<number> {
    const rows = await this.db
      .update(schema.messages)
      .set({ isStreaming: false, isComplete: false, updatedAt: new Date() })
      .where(and(eq(schema.messages.isStreaming, true), lt(schema.messages.updatedAt, cutoff)))
      .returning({ id: schema.messages.id });
    return rows.length;
  }

  async updateUser(
    id: string,
    input: { content: string; agentIds?: string[]; memberIds?: string[]; editedAt: Date },
  ): Promise<MessageRecord | null> {
    const [row] = await this.db
      .update(schema.messages)
      .set({
        content: input.content,
        isEdited: true,
        editedAt: input.editedAt,
        ...(input.agentIds !== undefined ? { agentIds: input.agentIds } : {}),
        ...(input.memberIds !== undefined ? { memberIds: input.memberIds } : {}),
        updatedAt: input.editedAt,
      })
      .where(and(eq(schema.messages.id, id), eq(schema.messages.conversationType, 'user')))
      .returning();
    return row ? mapPostgresMessage(row) : null;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    return (
      await this.db
        .delete(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .returning({ id: schema.messages.id })
    ).length;
  }

  async findBranchesByQuestion(questionMessageId: string): Promise<MessageRecord[]> {
    return (
      await this.db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.questionMessageId, questionMessageId),
            eq(schema.messages.conversationType, 'ai'),
          ),
        )
        .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    ).map(mapPostgresMessage);
  }

  async findAiComponents(
    conversationId: string,
    messageId: string,
  ): Promise<AiMessageComponentsRecord | null> {
    const [row] = await this.db
      .select({ id: schema.messages.id, components: schema.messages.components })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.id, messageId),
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.conversationType, 'ai'),
        ),
      )
      .limit(1);
    return row
      ? { id: row.id.trim(), components: (row.components ?? []) as MessageComponent[] }
      : null;
  }

  async findReportMessageById(messageId: string): Promise<ReportMessageRecord | null> {
    const record = await this.findById(messageId);
    if (!record) return null;
    return {
      id: record.id,
      conversationType: record.conversationType,
      content: record.content ?? '',
      attachedFileIds: record.attachedFileIds,
      components: record.components ?? [],
      requestId: record.requestId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      durationMs: record.durationMs,
      isComplete: record.isComplete,
      questionMessageId: record.questionMessageId,
      answerMessageId: record.answerMessageId,
      createdAt: record.createdAt,
      reliabilityEvaluation: record.reliabilityEvaluation,
      correctionWorkflow: record.correctionWorkflow,
    };
  }

  private async update(
    id: string,
    patch: Partial<typeof schema.messages.$inferInsert>,
  ): Promise<MessageRecord | null> {
    const [row] = await this.db
      .update(schema.messages)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.messages.id, id))
      .returning();
    return row ? mapPostgresMessage(row) : null;
  }
}
