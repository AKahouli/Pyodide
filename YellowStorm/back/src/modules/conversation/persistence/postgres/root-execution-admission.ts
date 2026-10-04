import { and, eq, inArray } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import * as schema from '../../../postgres/schema';
import type { RegisterExecutionInput } from '../../root-work/root-work.store';
import type { DelegateResultV1, RootExecutionRecord, RootExecutionStatus } from '../../root-work/root-work.types';
import type { RootControlTransaction } from './root-background-owner';

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

export async function admitRootExecution(tx: RootControlTransaction, input: RegisterExecutionInput, backgroundReplay = false): Promise<RootExecutionRecord> {
    const [conversation] = await tx.select({ epoch: schema.conversations.rootWorkEpoch })
      .from(schema.conversations).where(eq(schema.conversations.id, input.conversationId))
      .limit(1).for('update');
    if (!conversation || conversation.epoch !== input.conversationEpoch) {
      throw new Error('Root execution admission is behind the conversation barrier');
    }
    if (input.parentExecutionId) {
      const [parent] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, input.parentExecutionId)).limit(1).for('update');
      const [background] = backgroundReplay ? await tx.select().from(schema.rootBackgroundJobs)
        .where(eq(schema.rootBackgroundJobs.executionId, input.executionId)).limit(1) : [];
      if (!parent || parent.conversationId !== input.conversationId || parent.role !== 'root'
        || parent.depth !== 0 || input.depth !== 1 || !['library_worker', 'temporary_worker'].includes(input.role)
        || (background ? parent.status === 'cancellation_requested' : !['running', 'waiting'].includes(parent.status))
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
    return existing;
}
