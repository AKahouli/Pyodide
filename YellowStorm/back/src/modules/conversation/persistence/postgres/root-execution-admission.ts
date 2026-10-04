import { and, eq, inArray } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import * as schema from '../../../postgres/schema';
import type { RegisterExecutionInput } from '../../root-work/root-work.store';
import type { DelegateResultV1, RootBackgroundJobOwnerV1, RootExecutionRecord, RootExecutionStatus } from '../../root-work/root-work.types';
import { requireBackgroundOwner, type RootControlTransaction } from './root-background-owner';
import { loadOwnedBackgroundItem } from './root-background-fanout';

type RootExecutionRow = typeof schema.rootExecutions.$inferSelect;
export function toRecord(row: RootExecutionRow): RootExecutionRecord {
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

export async function admitRootExecution(tx: RootControlTransaction, input: RegisterExecutionInput, backgroundReplay = false,
  coordinatorGrant?: RootBackgroundJobOwnerV1): Promise<RootExecutionRecord> {
    if (input.nativeState?.backgroundFanoutItem && !coordinatorGrant) {
      throw new Error('Fan-out worker admission requires coordinator ownership');
    }
    const [conversation] = await tx.select({ epoch: schema.conversations.rootWorkEpoch })
      .from(schema.conversations).where(eq(schema.conversations.id, input.conversationId))
      .limit(1).for('update');
    if (!conversation || conversation.epoch !== input.conversationEpoch) {
      throw new Error('Root execution admission is behind the conversation barrier');
    }
    const ownedItem = coordinatorGrant ? await loadOwnedBackgroundItem(tx, coordinatorGrant, input.executionId) : null;
    if (ownedItem) {
      const parentState = (ownedItem.parent.resultPayload as DelegateResultV1).nativeState!;
      const snapshot = ownedItem.role === 'temporary_worker' ? parentState.scope.immutableSnapshotRef
        : (parentState.rootContext.catalog as Array<{ agent_id: string; snapshot_digest: string }> | undefined)
          ?.find((entry) => entry.agent_id === ownedItem.request.agentId)?.snapshot_digest;
      if (coordinatorGrant!.producerExecutionId !== input.executionId || input.parentExecutionId !== ownedItem.parent.id
        || input.conversationId !== ownedItem.parent.conversationId || input.rootAgentId !== ownedItem.parent.rootAgentId
        || input.workGroupId !== ownedItem.parent.workGroupId || input.role !== ownedItem.role || input.depth !== 1
        || input.nativeState?.actorId !== ownedItem.job.actorId || input.nativeState.scope.executionId !== input.executionId
        || input.nativeState.scope.parentExecutionId !== ownedItem.parent.id || input.nativeState.scope.role !== ownedItem.role
        || input.nativeState.scope.depth !== 1 || input.nativeState.scope.conversationEpoch !== ownedItem.job.conversationEpoch
        || !snapshot || input.nativeState.scope.immutableSnapshotRef !== snapshot
        || input.nativeState.rootContext.selected_agent_id !== (ownedItem.request.agentId ?? input.executionId)
        || !isDeepStrictEqual(input.nativeState.admittedRequest, ownedItem.request)
        || input.nativeState.rootContext.delegate_request_digest !== ownedItem.item.requestDigest) {
        throw new Error('Fan-out worker registration conflicts with its owned reservation');
      }
      await requireBackgroundOwner(tx, { ...ownedItem.coordinator,
        resultPayload: ownedItem.coordinator.resultPayload as DelegateResultV1 }, coordinatorGrant);
      input = { ...input, nativeState: { ...input.nativeState!,
        backgroundFanoutItem: { coordinatorExecutionId: ownedItem.coordinator.id,
          manifestId: ownedItem.manifest.manifestId, digest: ownedItem.manifest.digest },
        sessionId: ownedItem.job.nativeSessionId, invocationId: ownedItem.job.nativeInvocationId,
        scope: { ...input.nativeState!.scope, nativeSessionId: ownedItem.job.nativeSessionId,
          nativeInvocationId: ownedItem.job.nativeInvocationId, expectedFence: String(ownedItem.job.fence),
          deadlineEpochMs: ownedItem.job.deadline.getTime() } } };
    }
    if (input.parentExecutionId) {
      const [parent] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, input.parentExecutionId)).limit(1).for('update');
      const [background] = backgroundReplay ? await tx.select().from(schema.rootBackgroundJobs)
        .where(eq(schema.rootBackgroundJobs.executionId, input.executionId)).limit(1) : [];
      if (!parent || parent.conversationId !== input.conversationId || parent.role !== 'root'
        || parent.depth !== 0 || input.depth !== 1 || !['library_worker', 'temporary_worker'].includes(input.role)
        || (background || ownedItem ? parent.status === 'cancellation_requested' : !['running', 'waiting'].includes(parent.status))
        || parent.conversationEpoch !== input.conversationEpoch) {
        throw new Error('Worker admission requires an active root parent');
      }
      const [replay] = await tx.select({ id: schema.rootExecutions.id, terminalAt: schema.rootExecutions.terminalAt }).from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, input.executionId)).limit(1);
      const state = (parent.resultPayload as DelegateResultV1 | null)?.nativeState;
      const duration = Number(state?.rootContext.max_work_group_duration_seconds ?? 0);
      if (!replay?.terminalAt && duration > 0 && Date.now() >= parent.createdAt.getTime() + duration * 1000) {
        throw new Error('Root child execution deadline expired');
      }
      if (!replay) {
        const children = await tx.select({ id: schema.rootExecutions.id, role: schema.rootExecutions.role })
          .from(schema.rootExecutions).where(and(eq(schema.rootExecutions.parentExecutionId, input.parentExecutionId),
            inArray(schema.rootExecutions.role, ['library_worker', 'temporary_worker'])));
        const admittedIds = new Set(children.map((child) => child.id));
        const reservations = (state?.fanoutManifests ?? []).flatMap((manifest) => manifest.items
          .filter((item) => !admittedIds.has(item.executionId)).map((item) => ({ item, target: manifest.target })));
        const reservation = reservations.find(({ item }) => item.executionId === input.executionId);
        if (reservation && (input.role !== (reservation.target.kind === 'temporary' ? 'temporary_worker' : 'library_worker')
          || input.nativeState?.rootContext.delegate_request_digest !== reservation.item.requestDigest
          || reservation.target.kind === 'library'
            && input.nativeState?.rootContext.selected_agent_id !== reservation.target.agentId)) {
          throw new Error('Fan-out item conflicts with its reserved target or request');
        }
        if (input.role === 'temporary_worker') {
          const allowance = Number(state?.rootContext.max_temporary_workers ?? 0);
          const count = children.filter((child) => child.role === 'temporary_worker').length
            + reservations.filter(({ target }) => target.kind === 'temporary').length;
          if (state?.rootContext.temporary_workers_enabled !== true
            || !Number.isSafeInteger(allowance) || allowance < 1 || count + (reservation ? 0 : 1) > allowance) {
            throw new Error('Root temporary worker allowance exhausted or disabled');
          }
        }
        const budget = Number(state?.rootContext.max_child_executions_per_work_group ?? 0);
        const count = children.length + reservations.length;
        if (!Number.isSafeInteger(budget) || budget < 1 || count + (reservation ? 0 : 1) > budget) {
          throw new Error('Root child execution budget exhausted');
        }
      }
    }
    const inserted = await tx
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
        resultPayload: input.nativeState ? {
          executionId: input.executionId, producerAgentId: input.rootAgentId,
          producerRole: input.role, status: 'running', text: null,
          citationRefs: [], artifactRefs: [], safeError: null, nativeState: input.nativeState,
        } : null,
      })
      .onConflictDoNothing({ target: schema.rootExecutions.id })
      .returning();
    if (inserted.length > 0) {
      if (ownedItem) await requireBackgroundOwner(tx, { ...ownedItem.coordinator,
        resultPayload: ownedItem.coordinator.resultPayload as DelegateResultV1 }, coordinatorGrant);
      return toRecord(inserted[0]);
    }
    // Concurrent duplicate registration: return the winning row.
    const [existingRow] = await tx.select().from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, input.executionId)).limit(1);
    const existing = existingRow ? toRecord(existingRow) : null;
    if (!existing) {
      throw new Error(`root execution ${input.executionId} conflicted but was not found`);
    }
    if (existing.conversationId !== input.conversationId || existing.role !== input.role
      || existing.parentExecutionId !== input.parentExecutionId || existing.conversationEpoch !== input.conversationEpoch
      || existing.rootAgentId !== input.rootAgentId || existing.workGroupId !== input.workGroupId
      || existing.depth !== input.depth || existing.attempt !== input.attempt) {
      throw new Error('Root execution identity conflicts with its persisted scope');
    }
    if (input.parentExecutionId && (!isDeepStrictEqual(existing.resultPayload?.nativeState?.rootContext, input.nativeState?.rootContext)
      || !isDeepStrictEqual(existing.resultPayload?.nativeState?.admittedRequest, input.nativeState?.admittedRequest)
      || existing.resultPayload?.nativeState?.resolvedDefinitionsDigest !== input.nativeState?.resolvedDefinitionsDigest
      || existing.resultPayload?.nativeState?.scope.immutableSnapshotRef !== input.nativeState?.scope.immutableSnapshotRef)) {
      throw new Error('Worker replay conflicts with its frozen request or definition');
    }
    if (existing.resultPayload?.nativeState?.backgroundJobId && !backgroundReplay) {
      throw new Error('Background hydration requires an owned job path');
    }
    if (existing.resultPayload?.nativeState?.backgroundFanoutItem && !ownedItem) {
      throw new Error('Fan-out worker hydration requires coordinator ownership');
    }
    if (ownedItem) await requireBackgroundOwner(tx, { ...ownedItem.coordinator,
      resultPayload: ownedItem.coordinator.resultPayload as DelegateResultV1 }, coordinatorGrant);
    return existing;
}
