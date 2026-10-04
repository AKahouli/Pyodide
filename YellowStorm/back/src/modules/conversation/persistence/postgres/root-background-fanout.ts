import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { stableStringify } from '../../../agent/services/agent-execution-snapshot.service';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1, RootNativeState } from '../../root-work/root-work.types';
import type { RootBackgroundJobOwnerV1 } from '../../root-work/root-work.types';
import type { FanoutManifestV1 } from '../../root-work/root-fanout-manifest';
import { requireBackgroundOwner, type RootControlTransaction } from './root-background-owner';

type Execution = typeof schema.rootExecutions.$inferSelect;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const backgroundFanoutExecutionId = (parentId: string, branch: string) =>
  hash(`${parentId}:${branch}:background_fanout`).slice(0, 24);

/** Verify the immutable proposal seal and every derived producer identity on recovery. */
function sealedManifest(parentId: string, manifest: FanoutManifestV1): boolean {
  try {
    const items = manifest.items.map((item) => ({ key: item.key, task: item.task,
      ...(item.expectedOutput === undefined ? {} : { expectedOutput: item.expectedOutput }), contextRefs: item.contextRefs ?? [] }));
    const proposal = { version: manifest.version, mode: manifest.mode, nativeCallId: manifest.nativeCallId,
      nativeCallBranch: manifest.nativeCallBranch, target: manifest.target, items };
    if (hash(stableStringify(proposal)) !== manifest.digest
      || hash(`${parentId}:${manifest.nativeCallBranch}`).slice(0, 24) !== manifest.manifestId) return false;
    return manifest.items.every((item) => {
      const nativeRunId = `item_${hash(`${manifest.manifestId}:${item.key}`)}`;
      const tool = manifest.target.kind === 'library' ? 'delegate_to_agent' : 'spawn_temporary_worker';
      const branch = `${manifest.nativeCallBranch}.${nativeRunId}.${tool}@${nativeRunId}`;
      const request = { task: item.task, expectedOutput: item.expectedOutput ?? '', contextRefs: item.contextRefs ?? [],
        ...(manifest.target.kind === 'library' ? { agentId: manifest.target.agentId } : { nativeCallId: nativeRunId, nativeCallBranch: branch }) };
      return item.nativeRunId === nativeRunId && item.nativeCallBranch === branch
        && item.executionId === hash(`${parentId}:${branch}`).slice(0, 24) && item.requestDigest === hash(stableStringify(request));
    });
  } catch {
    return false; // Invalid persisted JSON cannot authorize a producer.
  }
}

/** Only a stored ROOT reservation can authorize a coordinator, never a worker request. */
export function boundBackgroundManifest(parent: Execution, child: Execution, requestDigest: string): FanoutManifestV1 | null {
  const parentState = (parent.resultPayload as DelegateResultV1 | null)?.nativeState;
  const state = (child.resultPayload as DelegateResultV1 | null)?.nativeState;
  const binding = state?.backgroundFanout;
  const manifest = parentState?.fanoutManifests?.find((value) => value.manifestId === binding?.manifestId);
  return child.role === 'fanout_driver' && child.depth === 0 && child.parentExecutionId === parent.id
    && child.conversationId === parent.conversationId && child.conversationEpoch === parent.conversationEpoch
    && child.rootAgentId === parent.rootAgentId && state?.actorId === parentState?.actorId
    && state?.scope.role === 'fanout_driver' && state.scope.depth === 0 && state.scope.executionId === child.id
    && state.scope.parentExecutionId === parent.id
    && state?.scope.immutableSnapshotRef === parentState?.scope.immutableSnapshotRef
    && manifest?.mode === 'background' && manifest.digest === requestDigest && binding?.digest === requestDigest
    && child.id === backgroundFanoutExecutionId(parent.id, manifest.nativeCallBranch)
    && sealedManifest(parent.id, manifest) ? manifest : null;
}

/** Caller already holds conversation→ROOT locks through complete manifest reservation. */
export async function registerBackgroundCoordinator(tx: RootControlTransaction, parentId: string, manifest: FanoutManifestV1) {
  const [parent] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, parentId)).limit(1);
  const state = (parent?.resultPayload as DelegateResultV1 | null)?.nativeState;
  if (!parent || !state || manifest.mode !== 'background') throw new Error('Background coordinator ROOT unavailable');
  const executionId = backgroundFanoutExecutionId(parentId, manifest.nativeCallBranch);
  const sessionId = `background_${executionId}`;
  const nativeState: RootNativeState = { actorId: state.actorId, sessionId, invocationId: null, pendingInputs: [],
    backgroundFanout: { manifestId: manifest.manifestId, digest: manifest.digest },
    rootContext: { delegate_request_digest: manifest.digest },
    scope: { ...state.scope, role: 'fanout_driver', executionId, parentExecutionId: parentId, depth: 0,
      attempt: 1, nativeSessionId: sessionId, nativeInvocationId: null, expectedFence: null, resumeIntent: 'start' } };
  await tx.insert(schema.rootExecutions).values({ id: executionId, conversationId: parent.conversationId,
    rootAgentId: parent.rootAgentId, workGroupId: parent.workGroupId, parentExecutionId: parentId,
    role: 'fanout_driver', depth: 0, attempt: 1, conversationEpoch: parent.conversationEpoch, status: 'running',
    resultPayload: { executionId, producerAgentId: parent.rootAgentId, producerRole: 'fanout_driver', status: 'running',
      text: null, citationRefs: [], artifactRefs: [], safeError: null, nativeState } })
    .onConflictDoNothing({ target: schema.rootExecutions.id });
  const [coordinator] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, executionId)).limit(1);
  if (!coordinator || !boundBackgroundManifest(parent, coordinator, manifest.digest)) {
    throw new Error('Background coordinator conflicts with its immutable manifest');
  }
  return coordinator;
}

/** Rehydration reads stored authority even when the original foreground ROOT has finished. */
export async function loadOwnedBackgroundFanout(tx: RootControlTransaction, grant: RootBackgroundJobOwnerV1) {
  const [identity] = await tx.select().from(schema.rootExecutions)
    .where(eq(schema.rootExecutions.id, grant.executionId)).limit(1);
  if (!identity?.parentExecutionId || identity.role !== 'fanout_driver') throw new Error('Owned fan-out unavailable');
  await tx.select({ id: schema.conversations.id }).from(schema.conversations)
    .where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
  const [parent] = await tx.select().from(schema.rootExecutions)
    .where(eq(schema.rootExecutions.id, identity.parentExecutionId)).limit(1).for('update');
  const [coordinator] = await tx.select().from(schema.rootExecutions)
    .where(eq(schema.rootExecutions.id, grant.executionId)).limit(1).for('update');
  if (!parent || !coordinator || !['running', 'waiting'].includes(coordinator.status)) throw new Error('Owned fan-out unavailable');
  const job = await requireBackgroundOwner(tx, { ...coordinator,
    resultPayload: coordinator.resultPayload as DelegateResultV1 }, grant, false);
  if (grant.nativeOwner !== undefined && (job.nativeOwner !== grant.nativeOwner || job.nativeOwnerFence !== job.fence)) {
    throw new Error('Background native owner changed');
  }
  const manifest = boundBackgroundManifest(parent, coordinator, job.requestDigest);
  if (!manifest) throw new Error('Owned fan-out manifest changed');
  return { job, parent, coordinator, manifest };
}

export async function loadOwnedBackgroundItem(tx: RootControlTransaction, grant: RootBackgroundJobOwnerV1, executionId: string) {
  if (grant.producerExecutionId !== undefined && grant.producerExecutionId !== executionId) {
    throw new Error('Fan-out producer binding changed');
  }
  const owned = await loadOwnedBackgroundFanout(tx, grant);
  const item = owned.manifest.items.find((value) => value.executionId === executionId);
  if (!item) throw new Error('Worker is outside the owned fan-out manifest');
  const target = owned.manifest.target;
  const request = { nativeCallId: item.nativeRunId, nativeCallBranch: item.nativeCallBranch, task: item.task,
    expectedOutput: item.expectedOutput ?? '', contextRefs: item.contextRefs ?? [],
    ...(target.kind === 'library' ? { agentId: target.agentId } : {}) };
  return { ...owned, item, request, role: target.kind === 'library' ? 'library_worker' as const : 'temporary_worker' as const };
}

/** Mutation authority belongs to this producer; the coordinator retains its lease. */
export async function requireBackgroundItemOwner(tx: RootControlTransaction, execution: Execution,
  grant?: RootBackgroundJobOwnerV1) {
  const state = (execution.resultPayload as DelegateResultV1 | null)?.nativeState;
  if (!grant || grant.producerExecutionId !== execution.id || state?.backgroundFanoutItem?.coordinatorExecutionId !== grant.executionId) {
    throw new Error('Fan-out item mutation requires coordinator ownership');
  }
  const owned = await loadOwnedBackgroundItem(tx, grant, execution.id);
  const rootState = (owned.parent.resultPayload as DelegateResultV1).nativeState!;
  const snapshot = owned.role === 'temporary_worker' ? rootState.scope.immutableSnapshotRef
    : (rootState.rootContext.catalog as Array<{ agent_id: string; snapshot_digest: string }> | undefined)
      ?.find((entry) => entry.agent_id === owned.request.agentId)?.snapshot_digest;
  if (execution.parentExecutionId !== owned.parent.id || execution.role !== owned.role || execution.depth !== 1
    || execution.conversationId !== owned.job.conversationId || execution.conversationEpoch !== owned.job.conversationEpoch
    || execution.rootAgentId !== owned.parent.rootAgentId || state.scope.executionId !== execution.id
    || state.scope.parentExecutionId !== owned.parent.id || state.scope.role !== owned.role || state.scope.depth !== 1
    || state.scope.conversationEpoch !== owned.job.conversationEpoch || state.scope.nativeSessionId !== owned.job.nativeSessionId
    || !snapshot || state.scope.immutableSnapshotRef !== snapshot
    || state.rootContext.selected_agent_id !== (owned.request.agentId ?? execution.id)
    || state.backgroundFanoutItem.manifestId !== owned.manifest.manifestId
    || state.backgroundFanoutItem.digest !== owned.manifest.digest || state.actorId !== owned.job.actorId
    || state.sessionId !== owned.job.nativeSessionId || state.rootContext.delegate_request_digest !== owned.item.requestDigest
    || stableStringify(state.admittedRequest) !== stableStringify(owned.request)) {
    throw new Error('Fan-out producer binding changed');
  }
  return requireBackgroundOwner(tx, { ...owned.coordinator,
    resultPayload: owned.coordinator.resultPayload as DelegateResultV1 }, grant);
}
