import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as schema from '../../../postgres/schema';
import { ErrorCode, NotFoundException } from '../../../exceptions';
import type { DelegateResultV1 } from '../../root-work/root-work.types';
import type { RootControlTransaction } from './root-background-owner';
import { releaseLegacyFollowupWriter } from './root-followup-writer';

/** Fence only this job and its fan-out items; preserve siblings and action receipts. */
export async function cancelBackgroundJob(tx: RootControlTransaction, conversationId: string,
  actorId: string, executionId: string, expectedEpoch: number) {
  const denied = () => new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Background task is unavailable');
  const [conversation] = await tx.select().from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId)).limit(1).for('update');
  if (!conversation || conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup
    || conversation.rootWorkEpoch !== expectedEpoch) throw denied();
  const [execution] = await tx.select().from(schema.rootExecutions)
    .where(eq(schema.rootExecutions.id, executionId)).limit(1).for('update');
  const [job] = await tx.select().from(schema.rootBackgroundJobs)
    .where(eq(schema.rootBackgroundJobs.executionId, executionId)).limit(1).for('update');
  if (!execution || !job || execution.conversationId !== conversationId || job.conversationId !== conversationId
    || execution.rootAgentId !== conversation.rootAgentId || job.actorId !== actorId
    || execution.conversationEpoch !== expectedEpoch || job.conversationEpoch !== expectedEpoch) throw denied();
  if (!['queued', 'running', 'waiting', 'outcome_unknown'].includes(job.status)) {
    if (execution.role === 'followup') await releaseLegacyFollowupWriter(tx, execution, job.status === 'cancelled');
    return { executionId, status: job.status, cancellationRequested: false, affectedCount: 0 };
  }
  if (execution.role === 'followup') await releaseLegacyFollowupWriter(tx, execution, true);
  const now = new Date();
  const affected = await tx.select().from(schema.rootExecutions).where(and(
    eq(schema.rootExecutions.conversationId, conversationId), eq(schema.rootExecutions.conversationEpoch, expectedEpoch),
    or(eq(schema.rootExecutions.id, executionId),
      sql`${schema.rootExecutions.resultPayload}->'nativeState'->'backgroundFanoutItem'->>'coordinatorExecutionId' = ${executionId}`),
    inArray(schema.rootExecutions.status, ['running', 'waiting', 'outcome_unknown', 'cancellation_requested'])));
  for (const child of affected) {
    const payload = child.resultPayload as DelegateResultV1 | null;
    await tx.update(schema.rootExecutions).set({ status: 'cancelled', updatedAt: now,
      resultPayload: payload ? { ...payload, status: 'cancelled',
        safeError: 'Task cancelled. Previously started external effects may still require reconciliation.' } : payload })
      .where(eq(schema.rootExecutions.id, child.id));
  }
  await tx.update(schema.rootBackgroundJobs).set({ status: 'cancelled', owner: null, leaseUntil: null,
    fence: sql`${schema.rootBackgroundJobs.fence} + 1`, updatedAt: now })
    .where(eq(schema.rootBackgroundJobs.executionId, executionId));
  // Provider and worker permits remain owned until confirmed native termination.
  // Cancellation must never make an uncertain external effect eligible for retry.
  const payload = { kind: 'task_cancelled', executionId, conversationEpoch: expectedEpoch };
  await tx.insert(schema.rootBackgroundEvents).values({ executionId, conversationId, actorId,
    conversationEpoch: expectedEpoch, eventId: `${executionId}_cancelled`, payload,
    payloadDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') });
  return { executionId, status: 'cancelled' as const,
    cancellationRequested: job.status === 'running' || job.startedAt !== null, affectedCount: affected.length };
}
