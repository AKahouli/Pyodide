import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1 } from '../../root-work/root-work.types';
import { buildFanoutManifest, FanoutManifestV1 } from '../../root-work/root-fanout-manifest';
import type { RootControlTransaction } from './root-background-owner';

/** Reserve the complete finite manifest with the same lock order as Stop/admission. */
export async function reserveFanoutManifest(db: NodePgDatabase<typeof schema>, parentId: string,
  proposal: unknown): Promise<FanoutManifestV1> {
  return db.transaction((tx) => reserveFanoutManifestInTransaction(tx, parentId, proposal));
}

/** Lets trusted background admission commit its job and full reservation together. */
export async function reserveFanoutManifestInTransaction(tx: RootControlTransaction, parentId: string,
  proposal: unknown, allowBackground = false): Promise<FanoutManifestV1> {
    const [identity] = await tx.select({ conversationId: schema.rootExecutions.conversationId })
      .from(schema.rootExecutions).where(eq(schema.rootExecutions.id, parentId)).limit(1);
    if (!identity) throw new Error('Fan-out ROOT unavailable');
    const [conversation] = await tx.select({ epoch: schema.conversations.rootWorkEpoch })
      .from(schema.conversations).where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
    const [parent] = await tx.select().from(schema.rootExecutions)
      .where(eq(schema.rootExecutions.id, parentId)).limit(1).for('update');
    const payload = parent?.resultPayload as DelegateResultV1 | null;
    const state = payload?.nativeState;
    if (!parent || !conversation || parent.role !== 'root' || parent.depth !== 0
      || !['running', 'waiting'].includes(parent.status) || parent.conversationEpoch !== conversation.epoch
      || !state?.capabilityCeiling || state.rootContext.fanout_enabled !== true) {
      throw new Error('Fan-out requires an enabled active ROOT');
    }
    const manifest = buildFanoutManifest(parentId, proposal, Number(state.rootContext.max_fanout_items),
      state.capabilityCeiling.workspaceIds, allowBackground);
    if (manifest.mode === 'background' && (state.rootContext.background_enabled !== true
      || state.rootContext.background_fanout_enabled !== true)) throw new Error('Background fan-out is disabled');
    const manifests = state.fanoutManifests ?? [];
    const replay = manifests.find((item) => item.manifestId === manifest.manifestId);
    if (replay) {
      if (replay.digest !== manifest.digest) throw new Error('Fan-out replay conflicts with its immutable manifest');
      return replay;
    }
    const duration = Number(state.rootContext.max_work_group_duration_seconds ?? 0);
    if (!Number.isSafeInteger(duration) || duration < 1 || Date.now() >= parent.createdAt.getTime() + duration * 1000) {
      throw new Error('Fan-out ROOT deadline expired');
    }
    if (manifest.target.kind === 'temporary') {
      if (state.rootContext.temporary_workers_enabled !== true) throw new Error('Temporary fan-out disabled');
    } else {
      const agentId = manifest.target.agentId;
      if (!(state.rootContext.catalog as Array<{ agent_id: string }> | undefined)
        ?.some((entry) => entry.agent_id === agentId)) {
        throw new Error('Fan-out specialist is outside the frozen pool');
      }
    }
    const children = await tx.select({ id: schema.rootExecutions.id, role: schema.rootExecutions.role })
      .from(schema.rootExecutions).where(and(eq(schema.rootExecutions.parentExecutionId, parentId),
        inArray(schema.rootExecutions.role, ['library_worker', 'temporary_worker'])));
    const admitted = new Set(children.map((child) => child.id));
    const reserved = manifests.flatMap((item) => item.items.filter((child) => !admitted.has(child.executionId)));
    const budget = Number(state.rootContext.max_child_executions_per_work_group ?? 0);
    if (!Number.isSafeInteger(budget) || children.length + reserved.length + manifest.items.length > budget) {
      throw new Error('Fan-out child budget exhausted');
    }
    if (manifest.target.kind === 'temporary') {
      const temporaryReserved = manifests.filter((item) => item.target.kind === 'temporary')
        .flatMap((item) => item.items.filter((child) => !admitted.has(child.executionId))).length;
      const allowance = Number(state.rootContext.max_temporary_workers ?? 0);
      if (!Number.isSafeInteger(allowance) || children.filter((child) => child.role === 'temporary_worker').length
        + temporaryReserved + manifest.items.length > allowance) throw new Error('Fan-out temporary allowance exhausted');
    }
    await tx.update(schema.rootExecutions).set({ resultPayload: { ...payload,
      nativeState: { ...state, fanoutManifests: [...manifests, manifest] } }, updatedAt: new Date() })
      .where(and(eq(schema.rootExecutions.id, parentId), eq(schema.rootExecutions.conversationEpoch, conversation.epoch)));
    return manifest;
}
