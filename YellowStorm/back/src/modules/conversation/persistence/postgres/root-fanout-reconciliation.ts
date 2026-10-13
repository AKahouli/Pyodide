import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1 } from '../../root-work/root-work.types';
import type { RootControlTransaction } from './root-background-owner';
import { boundBackgroundManifest } from './root-background-fanout';
import { stableStringify } from '../../../agent/services/agent-execution-snapshot.service';

type Execution = typeof schema.rootExecutions.$inferSelect;
type Job = typeof schema.rootBackgroundJobs.$inferSelect;

/** Caller holds the conversation and job locks, with live ownership or expiry authority. */
export async function reconcileUncertainFanout(tx: RootControlTransaction, parent: Execution, coordinator: Execution, job: Job) {
  const manifest = boundBackgroundManifest(parent, coordinator, job.requestDigest);
  if (!manifest || job.executionId !== coordinator.id || job.parentExecutionId !== parent.id
    || job.conversationId !== parent.conversationId || job.conversationEpoch !== parent.conversationEpoch) {
    throw new Error('Uncertain fan-out binding changed');
  }
  const root = (parent.resultPayload as DelegateResultV1).nativeState!;
  const role = manifest.target.kind === 'library' ? 'library_worker' : 'temporary_worker';
  let affected = 0;
  for (const item of manifest.items) {
    const [child] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, item.executionId)).limit(1).for('update');
    if (!child || !['running', 'waiting', 'cancellation_requested'].includes(child.status)) continue;
    const payload = child.resultPayload as DelegateResultV1 | null;
    const state = payload?.nativeState;
    const snapshot = manifest.target.kind === 'temporary' ? root.scope.immutableSnapshotRef
      : (root.rootContext.catalog as Array<{ agent_id: string; snapshot_digest: string }> | undefined)
        ?.find((entry) => entry.agent_id === (manifest.target as { agentId: string }).agentId)?.snapshot_digest;
    const request = { nativeCallId: item.nativeRunId, nativeCallBranch: item.nativeCallBranch, task: item.task,
      expectedOutput: item.expectedOutput ?? '', contextRefs: item.contextRefs ?? [],
      ...(manifest.target.kind === 'library' ? { agentId: manifest.target.agentId } : {}) };
    if (!state || child.parentExecutionId !== parent.id || child.conversationId !== job.conversationId
      || child.conversationEpoch !== job.conversationEpoch || child.role !== role || child.depth !== 1
      || child.rootAgentId !== parent.rootAgentId || state.actorId !== job.actorId || state.sessionId !== job.nativeSessionId
      || state.scope.executionId !== child.id || state.scope.parentExecutionId !== parent.id || state.scope.role !== role
      || state.scope.depth !== 1 || state.scope.conversationEpoch !== job.conversationEpoch
      || state.scope.nativeSessionId !== job.nativeSessionId || !snapshot || state.scope.immutableSnapshotRef !== snapshot
      || state.backgroundFanoutItem?.coordinatorExecutionId !== coordinator.id
      || state.backgroundFanoutItem.manifestId !== manifest.manifestId || state.backgroundFanoutItem.digest !== manifest.digest
      || state.rootContext.delegate_request_digest !== item.requestDigest
      || state.rootContext.selected_agent_id !== (manifest.target.kind === 'library' ? manifest.target.agentId : child.id)
      || stableStringify(state.admittedRequest) !== stableStringify(request)) throw new Error('Uncertain producer binding changed');
    await tx.update(schema.rootExecutions).set({ status: 'outcome_unknown', terminalAt: new Date(), updatedAt: new Date(),
      resultPayload: payload ? { ...payload, status: 'outcome_unknown' } : null })
      .where(and(eq(schema.rootExecutions.id, child.id), inArray(schema.rootExecutions.status, ['running', 'waiting', 'cancellation_requested'])));
    affected++;
  }
  return affected;
}
