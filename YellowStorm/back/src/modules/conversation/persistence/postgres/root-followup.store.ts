import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash } from 'node:crypto';
import { DRIZZLE_DB } from '../../../postgres/postgres.constants';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1, RootNativeState } from '../../root-work/root-work.types';
import { newOwnedId } from '../owned-id';
import { requireBackgroundOwner, type RootControlTransaction } from './root-background-owner';
import type { RootJobOwner } from './root-background-job.store';
import { loadFollowupEvidence } from './root-followup-evidence';

type Execution = typeof schema.rootExecutions.$inferSelect;
const stateOf = (execution: Execution) => (execution.resultPayload as DelegateResultV1 | null)?.nativeState;

@Injectable()
export class RootFollowupStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async candidates(afterId?: string) {
    return this.db.select().from(schema.rootExecutions).where(and(eq(schema.rootExecutions.role, 'root'),
      inArray(schema.rootExecutions.status, ['completed', 'failed']),
      sql`${schema.rootExecutions.resultPayload}->'nativeState'->'schedulingSeal' IS NOT NULL`,
      ...(afterId ? [gt(schema.rootExecutions.id, afterId)] : []),
      sql`NOT EXISTS (SELECT 1 FROM conversation.root_executions f
        WHERE f.id = ${schema.rootExecutions.resultPayload}->'nativeState'->'schedulingSeal'->>'followupExecutionId')`))
      .orderBy(schema.rootExecutions.id).limit(32);
  }

  async completed(afterId?: string) {
    return this.db.select().from(schema.rootExecutions).where(and(eq(schema.rootExecutions.role, 'followup'),
      eq(schema.rootExecutions.status, 'completed'),
      sql`${schema.rootExecutions.resultPayload}->'nativeState'->'followup'->>'publishedAt' IS NULL`,
      ...(afterId ? [gt(schema.rootExecutions.id, afterId)] : []))).orderBy(schema.rootExecutions.id).limit(32);
  }

  private async members(tx: RootControlTransaction, root: Execution, state: RootNativeState) {
    const seal = state.schedulingSeal!;
    if (!seal.resultManifest.length) return null;
    const rows = await tx.select().from(schema.rootExecutions)
      .where(inArray(schema.rootExecutions.id, seal.resultManifest.map((item) => item.executionId)));
    if (rows.length !== seal.resultManifest.length || rows.some((row) => row.parentExecutionId !== root.id
      || row.conversationId !== root.conversationId || row.conversationEpoch !== root.conversationEpoch
      || !['completed', 'failed', 'cancelled'].includes(row.status)
      || row.role !== seal.resultManifest.find((item) => item.executionId === row.id)?.role)) return null;
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  async reserve(rootId: string, actorId: string, expectedDigest: string) {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, rootId)).limit(1);
      if (!identity) return null;
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
      const [root] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, rootId)).limit(1).for('update');
      const state = stateOf(root);
      const seal = state?.schedulingSeal;
      if (!conversation || !state || !seal || seal.digest !== expectedDigest || root.role !== 'root'
        || !['completed', 'failed'].includes(root.status) || conversation.rootWorkEpoch !== root.conversationEpoch
        || conversation.createdBy !== actorId || state.actorId !== actorId || conversation.isArchived || conversation.isGroup
        || conversation.rootAgentId !== root.rootAgentId) return null;
      const [existing] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, seal.followupExecutionId)).limit(1);
      if (existing) {
        if (existing.role !== 'followup' || existing.parentExecutionId !== rootId
          || existing.conversationEpoch !== root.conversationEpoch || stateOf(existing)?.followup?.manifestDigest !== seal.digest) {
          throw new Error('Synthesis reservation identity conflicts');
        }
        return existing;
      }
      const members = await this.members(tx, root, state);
      if (!members) return null;
      // Missing writer-slot storage throws; synthesis never falls back to a
      // process-local lock. Pending ordinary placeholders retain priority.
      const [pendingUser] = await tx.select({ id: schema.messages.id }).from(schema.messages).where(and(
        eq(schema.messages.conversationId, root.conversationId), eq(schema.messages.conversationType, 'ai'),
        eq(schema.messages.isComplete, false), eq(schema.messages.isStreaming, true))).limit(1);
      const [approval] = await tx.select({ id: schema.rootExecutions.id }).from(schema.rootExecutions).where(and(
        eq(schema.rootExecutions.conversationId, root.conversationId), eq(schema.rootExecutions.conversationEpoch, root.conversationEpoch),
        eq(schema.rootExecutions.status, 'waiting'))).limit(1);
      if (pendingUser || approval) return null;
      const publicationMessageId = newOwnedId();
      const deadline = new Date(Math.min(Date.now() + 300000, state.scope.deadlineEpochMs ?? Infinity));
      if (deadline.getTime() <= Date.now()) return null;
      const [writer] = await tx.insert(schema.conversationExecutions).values({ id: seal.followupExecutionId,
        conversationId: root.conversationId, userId: actorId, messageId: publicationMessageId,
        ownerReplicaId: 'root-followup', expiresAt: deadline }).onConflictDoNothing().returning();
      if (!writer) return null;
      const sessionId = `background_${seal.followupExecutionId}`;
      const evidence = await loadFollowupEvidence(tx, members);
      const task = JSON.stringify({ rootStatus: root.status,
        evidence: evidence.slice(0, 100).map(({ record, displayReference, nativeReference }) => ({ evidenceId: record.id,
          executionId: record.executionId, kind: record.kind, displayReference, nativeReference })),
        results: members.map((member) => {
        const result = member.resultPayload as DelegateResultV1 | null;
        return { executionId: member.id, status: member.status,
          text: result?.text?.slice(0, Math.min(8000, Math.floor(64000 / members.length))) ?? null,
          citationCount: result?.citationRefs.length ?? 0, artifactCount: result?.artifactRefs.length ?? 0,
          textTruncated: (result?.text?.length ?? 0) > Math.min(8000, Math.floor(64000 / members.length)),
          safeError: result?.safeError ?? null };
      }) });
      const digest = createHash('sha256').update(`${rootId}:${seal.digest}:${task}`).digest('hex');
      const nativeState: RootNativeState = { ...state, schedulingSeal: undefined, fanoutManifests: undefined,
        hasBackgroundJobs: undefined, workerPermits: undefined, backgroundJobId: seal.followupExecutionId,
        followup: { manifestDigest: seal.digest, publicationMessageId }, sessionId, invocationId: null, pendingInputs: [],
        scope: { ...state.scope, executionId: seal.followupExecutionId, parentExecutionId: rootId, role: 'followup', depth: 0,
          nativeSessionId: sessionId, nativeInvocationId: null, expectedFence: null, resumeIntent: 'start', deadlineEpochMs: deadline.getTime() },
        rootContext: { root_agent_id: root.rootAgentId, delegate_request_digest: digest },
        admittedRequest: { task, nativeCallId: seal.digest, nativeCallBranch: `synthesis@${seal.digest}` } };
      const [followup] = await tx.insert(schema.rootExecutions).values({ id: seal.followupExecutionId,
        conversationId: root.conversationId, rootAgentId: root.rootAgentId, workGroupId: root.workGroupId,
        parentExecutionId: rootId, role: 'followup', depth: 0, attempt: 1, conversationEpoch: root.conversationEpoch,
        resultPayload: { nativeState } }).returning();
      await tx.insert(schema.rootBackgroundJobs).values({ executionId: followup.id, parentExecutionId: rootId,
        conversationId: root.conversationId, actorId, conversationEpoch: root.conversationEpoch,
        requestDigest: digest, maxAttempts: 3, deadline, nativeSessionId: sessionId });
      return followup;
    });
  }

  async owned(grant: RootJobOwner) {
    return this.db.transaction(async (tx) => {
      const [execution] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, grant.executionId)).limit(1);
      if (!execution || execution.role !== 'followup' || !execution.parentExecutionId) throw new Error('Synthesis execution unavailable');
      await tx.select({ id: schema.conversations.id }).from(schema.conversations)
        .where(eq(schema.conversations.id, execution.conversationId)).limit(1).for('update');
      const job = await requireBackgroundOwner(tx, { ...execution, resultPayload: execution.resultPayload as DelegateResultV1 }, grant);
      const [root] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, execution.parentExecutionId)).limit(1);
      const state = stateOf(execution)!;
      if (!root || state.followup?.manifestDigest !== stateOf(root)?.schedulingSeal?.digest
        || execution.id !== stateOf(root)?.schedulingSeal?.followupExecutionId) throw new Error('Synthesis manifest changed');
      const [writer] = await tx.select().from(schema.conversationExecutions).where(and(
        eq(schema.conversationExecutions.id, execution.id), eq(schema.conversationExecutions.status, 'running'),
        sql`${schema.conversationExecutions.expiresAt} > clock_timestamp()`,
        eq(schema.conversationExecutions.messageId, state.followup!.publicationMessageId))).limit(1);
      if (!writer) throw new Error('Synthesis writer authority changed');
      return { execution, root, state, job };
    });
  }

  async readResult(grant: RootJobOwner, producerId: string, offset: number) {
    const owned = await this.owned(grant);
    if (!stateOf(owned.root)?.schedulingSeal?.resultManifest.some((member) => member.executionId === producerId)) {
      throw new Error('Synthesis result is outside the sealed manifest');
    }
    const result = await this.db.transaction(async (tx) => {
      const members = await this.members(tx, owned.root, stateOf(owned.root)!);
      if (!members) throw new Error('Synthesis results are not terminal');
      const member = members.find((item) => item.id === producerId)!;
      const payload = member.resultPayload as DelegateResultV1 | null;
      const fullText = member.status === 'completed' ? payload?.fullText ?? payload?.text ?? '' : '';
      const evidence = await loadFollowupEvidence(tx, members);
      return { executionId: producerId, status: member.status, text: fullText.slice(offset, offset + 8000),
        nextOffset: offset + 8000 < fullText.length ? offset + 8000 : null,
        safeError: payload?.safeError ?? null, evidence: evidence.filter((item) => item.record.executionId === producerId)
          .map(({ record, displayReference, nativeReference }) => ({ evidenceId: record.id, kind: record.kind,
            displayReference, nativeReference })) };
    });
    await this.owned(grant);
    return result;
  }

  async publish(executionId: string, actorId: string, manifestDigest: string) {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, executionId)).limit(1);
      if (!identity?.parentExecutionId) return null;
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
      const [root] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, identity.parentExecutionId)).limit(1).for('update');
      const [followup] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, executionId)).limit(1).for('update');
      const state = stateOf(followup);
      const result = followup.resultPayload as DelegateResultV1 | null;
      if (!conversation || !root || !state?.followup || followup.role !== 'followup' || followup.status !== 'completed'
        || conversation.rootWorkEpoch !== followup.conversationEpoch || conversation.createdBy !== actorId
        || conversation.isArchived || conversation.isGroup || conversation.rootAgentId !== root.rootAgentId
        || state.actorId !== actorId || state.followup.manifestDigest !== manifestDigest
        || stateOf(root)?.schedulingSeal?.digest !== manifestDigest) return null;
      const [alreadyPublished] = await tx.select().from(schema.messages).where(eq(schema.messages.id, state.followup.publicationMessageId)).limit(1);
      if (alreadyPublished) {
        if (!state.followup.publishedAt || alreadyPublished.conversationId !== followup.conversationId
          || alreadyPublished.conversationType !== 'ai' || !alreadyPublished.isComplete) {
          throw new Error('Synthesis publication message identity conflicts');
        }
        return alreadyPublished;
      }
      const members = await this.members(tx, root, stateOf(root)!);
      if (!members || typeof result?.fullText !== 'string' || Buffer.byteLength(result.fullText) > 262144) return null;
      const [writer] = await tx.select().from(schema.conversationExecutions).where(and(
        eq(schema.conversationExecutions.id, executionId), eq(schema.conversationExecutions.status, 'running'),
        sql`${schema.conversationExecutions.expiresAt} > clock_timestamp()`,
        eq(schema.conversationExecutions.messageId, state.followup.publicationMessageId))).limit(1).for('update');
      if (!writer) return null;
      const evidence = await loadFollowupEvidence(tx, members);
      const now = new Date();
      const aliases = new Set(evidence.map((item) => item.displayReference).filter(Boolean));
      for (const match of result.fullText.matchAll(/\[(\d+)\]/g)) {
        if (!aliases.has(match[1])) throw new Error('Synthesis references evidence outside its sealed registry');
      }
      const components = [{ id: `${executionId}_text`, type: 'text' as const, data: { content: result.fullText } },
        ...evidence.map((item) => item.component)];
      const [message] = await tx.insert(schema.messages).values({ id: state.followup.publicationMessageId,
        conversationId: followup.conversationId, senderId: actorId, conversationType: 'ai', components,
        isComplete: true, isStreaming: false, executionStatus: 'completed', executionTerminalAt: now }).returning();
      await tx.update(schema.conversations).set({ messageCount: sql`${schema.conversations.messageCount} + 1`,
        lastMessageAt: now, updatedAt: now }).where(eq(schema.conversations.id, followup.conversationId));
      await tx.update(schema.conversationExecutions).set({ status: 'completed', terminalAt: now, updatedAt: now })
        .where(eq(schema.conversationExecutions.id, executionId));
      await tx.update(schema.rootExecutions).set({ resultPayload: { ...result,
        nativeState: { ...state, followup: { ...state.followup, publishedAt: now.toISOString() } } }, updatedAt: now })
        .where(eq(schema.rootExecutions.id, executionId));
      const payload = { kind: 'followup_published', executionId, conversationEpoch: followup.conversationEpoch, messageId: message.id };
      await tx.insert(schema.rootBackgroundEvents).values({ executionId, conversationId: followup.conversationId,
        actorId, conversationEpoch: followup.conversationEpoch, eventId: `${executionId}_published`, payload,
        payloadDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') });
      return message;
    });
  }
}
