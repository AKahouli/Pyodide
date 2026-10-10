import { and, eq } from 'drizzle-orm';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1 } from '../../root-work/root-work.types';
import type { RootControlTransaction } from './root-background-owner';

type Execution = typeof schema.rootExecutions.$inferSelect;

/** Caller holds the conversation lock; only the pinned followup's old reservation can be released. */
export async function releaseLegacyFollowupWriter(tx: RootControlTransaction, execution: Execution, cancelled = false) {
  const state = (execution.resultPayload as DelegateResultV1 | null)?.nativeState;
  if (execution.role !== 'followup' || !state?.followup?.publicationMessageId) return;
  const now = new Date();
  await tx.update(schema.conversationExecutions).set({ status: cancelled ? 'cancelled' : 'completed',
    terminalAt: now, updatedAt: now, ...(cancelled ? { cancelRequestedAt: now } : {}) }).where(and(
    eq(schema.conversationExecutions.id, execution.id), eq(schema.conversationExecutions.conversationId, execution.conversationId),
    eq(schema.conversationExecutions.userId, state.actorId), eq(schema.conversationExecutions.ownerReplicaId, 'root-followup'),
    eq(schema.conversationExecutions.messageId, state.followup.publicationMessageId), eq(schema.conversationExecutions.status, 'running')));
}

export async function acquireFollowupWriter(tx: RootControlTransaction, execution: Execution) {
  const state = (execution.resultPayload as DelegateResultV1).nativeState!;
  const values = { id: execution.id, conversationId: execution.conversationId, userId: state.actorId,
    messageId: state.followup!.publicationMessageId, ownerReplicaId: 'root-followup', expiresAt: new Date(Date.now() + 30000) };
  const [inserted] = await tx.insert(schema.conversationExecutions).values(values).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [legacy] = await tx.select().from(schema.conversationExecutions).where(eq(schema.conversationExecutions.id, execution.id))
    .limit(1).for('update');
  if (!legacy || legacy.conversationId !== values.conversationId || legacy.userId !== values.userId
    || legacy.messageId !== values.messageId || legacy.ownerReplicaId !== values.ownerReplicaId
    || legacy.cancelRequestedAt || legacy.status === 'cancelled') return null;
  try {
    // The unique Conversation writer index also arbitrates a simultaneous user
    // admission. A savepoint makes losing that race a publication deferral.
    return await tx.transaction(async (savepoint) => {
      const [writer] = await savepoint.update(schema.conversationExecutions).set({ status: 'running',
        expiresAt: values.expiresAt, terminalAt: null, updatedAt: new Date() })
        .where(eq(schema.conversationExecutions.id, execution.id)).returning();
      return writer;
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? error;
    if ((cause as { code?: string }).code === '23505'
      && (cause as { constraint?: string }).constraint === 'uq_conversation_executions_running_conversation') return null;
    throw error;
  }
}
