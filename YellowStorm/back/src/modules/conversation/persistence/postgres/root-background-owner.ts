import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1, RootBackgroundJobOwnerV1, RootExecutionRecord } from '../../root-work/root-work.types';

export type RootControlTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Caller already holds the conversation lock, before taking the job lock. */
export async function requireBackgroundOwner(tx: RootControlTransaction, execution: Pick<RootExecutionRecord,
  'id' | 'conversationId' | 'conversationEpoch' | 'parentExecutionId' | 'resultPayload'>, grant?: RootBackgroundJobOwnerV1,
  requireNativeOwner = true) {
  const state = execution.resultPayload?.nativeState;
  if (!grant || grant.executionId !== execution.id || !/^[A-Za-z0-9_-]{1,128}$/.test(grant.owner)
    || !Number.isSafeInteger(grant.fence) || grant.fence < 1 || state?.backgroundJobId !== execution.id) {
    throw new Error('Background lifecycle requires owned job authority');
  }
  const [job] = await tx.select().from(schema.rootBackgroundJobs).where(and(
    eq(schema.rootBackgroundJobs.executionId, execution.id), eq(schema.rootBackgroundJobs.owner, grant.owner),
    eq(schema.rootBackgroundJobs.fence, grant.fence), eq(schema.rootBackgroundJobs.status, 'running'),
    sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`, sql`${schema.rootBackgroundJobs.deadline} > clock_timestamp()`,
  )).limit(1).for('update');
  if (!job || job.conversationId !== execution.conversationId || job.conversationEpoch !== execution.conversationEpoch
    || job.parentExecutionId !== execution.parentExecutionId || job.actorId !== state.actorId
    || job.requestDigest !== state.rootContext.delegate_request_digest || job.nativeSessionId !== state.sessionId
    || requireNativeOwner && (!grant.nativeOwner || job.nativeOwner !== grant.nativeOwner
      || job.nativeOwner !== null && job.nativeOwnerFence !== job.fence)) {
    throw new Error('Background owner, fence or immutable binding changed');
  }
  const [conversation] = await tx.select().from(schema.conversations)
    .where(eq(schema.conversations.id, job.conversationId)).limit(1);
  const [parent] = await tx.select().from(schema.rootExecutions)
    .where(eq(schema.rootExecutions.id, job.parentExecutionId)).limit(1);
  if (!conversation || !parent || conversation.isArchived || conversation.isGroup
    || conversation.createdBy !== job.actorId || conversation.rootWorkEpoch !== job.conversationEpoch
    || conversation.rootAgentId !== parent.rootAgentId || parent.conversationId !== job.conversationId
    || parent.conversationEpoch !== job.conversationEpoch || parent.role !== 'root' || parent.depth !== 0
    || parent.status === 'cancellation_requested'
    || (parent.resultPayload as DelegateResultV1 | null)?.nativeState?.actorId !== job.actorId) {
    throw new Error('Background conversation or ROOT authority changed');
  }
  return job;
}
