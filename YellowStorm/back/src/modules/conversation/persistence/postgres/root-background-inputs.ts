import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash } from 'node:crypto';
import * as schema from '../../../postgres/schema';
import { stableStringify } from '../../../agent/services/agent-execution-snapshot.service';
import { validateNativeInputResponses } from '../../root-work/native-input-responses';
import type { RootContinuationRequest } from '../../interfaces/message.interface';
import type { DelegateResultV1 } from '../../root-work/root-work.types';

export async function queueBackgroundInputs(db: NodePgDatabase<typeof schema>, conversationId: string,
  executionId: string, actorId: string, inputResponses: RootContinuationRequest['inputResponses']) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx.select().from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId)).limit(1).for('update');
    const [child] = await tx.select().from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, executionId)).limit(1).for('update');
    const [job] = await tx.select().from(schema.rootBackgroundJobs)
      .where(eq(schema.rootBackgroundJobs.executionId, executionId)).limit(1).for('update');
    const [parent] = job ? await tx.select().from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, job.parentExecutionId)).limit(1) : [];
    const state = (child?.resultPayload as DelegateResultV1 | null)?.nativeState;
    if (!conversation || !child || !job || !parent || !state || conversation.isArchived || conversation.isGroup
      || conversation.createdBy !== actorId || job.actorId !== actorId || state.actorId !== actorId
      || child.conversationId !== conversationId || job.conversationId !== conversationId
      || child.conversationEpoch !== conversation.rootWorkEpoch || job.conversationEpoch !== conversation.rootWorkEpoch
      || child.parentExecutionId !== parent.id || parent.conversationId !== conversationId
      || parent.conversationEpoch !== conversation.rootWorkEpoch || parent.rootAgentId !== conversation.rootAgentId
      || parent.role !== 'root' || parent.depth !== 0 || parent.status === 'cancellation_requested'
      || (parent.resultPayload as DelegateResultV1 | null)?.nativeState?.actorId !== actorId
      || state.backgroundJobId !== executionId || state.invocationId !== job.nativeInvocationId
      || state.sessionId !== job.nativeSessionId || state.rootContext.delegate_request_digest !== job.requestDigest
      || !job.nativeInvocationId || !['library_worker', 'temporary_worker'].includes(child.role) || child.depth !== 1) {
      throw new Error('Background input authority changed');
    }
    const requestDigest = createHash('sha256').update(stableStringify({ nativeInvocationId: job.nativeInvocationId,
      inputResponses })).digest('hex');
    if (job.inputResponseDigest === requestDigest) return { executionId, status: job.status };
    if (job.status !== 'waiting' || child.status !== 'waiting' || child.terminalAt) throw new Error('Background invocation is not waiting');
    validateNativeInputResponses(state.pendingInputs, inputResponses);
    const responses = inputResponses.map((input) => ({ input_id: input.inputId, response: input.response,
      input_version: input.inputVersion ?? 1,
      function_name: state.pendingInputs.find((pending) => pending.inputId === input.inputId)!.functionName }));
    const changed = await tx.update(schema.rootBackgroundJobs).set({ status: 'queued', owner: null,
      nativeOwner: null, nativeOwnerFence: null, leaseUntil: null, fence: job.fence + 1, attempts: 0,
      pendingInputResponses: responses, inputResponseDigest: requestDigest, inputResponseEventId: null,
      availableAt: sql`clock_timestamp()`, updatedAt: new Date() }).where(sql`${schema.rootBackgroundJobs.executionId} = ${executionId}
        AND ${schema.rootBackgroundJobs.deadline} > clock_timestamp()`).returning();
    if (changed.length !== 1) throw new Error('Background input deadline expired');
    return { executionId, status: 'queued' };
  });
}
