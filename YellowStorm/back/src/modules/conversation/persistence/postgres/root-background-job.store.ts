import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1, RootBackgroundJobOwnerV1 } from '../../root-work/root-work.types';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../agent/services/agent-execution-snapshot.service';
import { requireBackgroundOwner } from './root-background-owner';
import { queueBackgroundInputs } from './root-background-inputs';
import { admitRootExecution } from './root-execution-admission';
import type { RegisterExecutionInput } from '../../root-work/root-work.store';
import type { RootContinuationRequest } from '../../interfaces/message.interface';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB } from '../../../postgres/postgres.constants';

export type RootBackgroundJob = typeof schema.rootBackgroundJobs.$inferSelect;
export type RootJobOwner = RootBackgroundJobOwnerV1;
type RootTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** No polling/worker startup here: background remains disabled until qualified. */
@Injectable()
export class RootBackgroundJobStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async getJob(executionId: string) {
    const [job] = await this.db.select().from(schema.rootBackgroundJobs)
      .where(eq(schema.rootBackgroundJobs.executionId, executionId)).limit(1);
    return job ?? null;
  }

  /** Trusted scheduler seam; returns persisted inputs, never caller-supplied replacements. */
  async getOwnedHydration(grant: RootJobOwner) {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, grant.executionId)).limit(1);
      if (!identity?.parentExecutionId) throw new Error('Owned worker unavailable');
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
      const [parent] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, identity.parentExecutionId)).limit(1).for('update');
      const [child] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, grant.executionId)).limit(1).for('update');
      const state = (child?.resultPayload as DelegateResultV1 | null)?.nativeState;
      if (!conversation || !parent || !child || !state || !this.currentBinding(conversation, parent, state.actorId)
        || child.conversationEpoch !== conversation.rootWorkEpoch || child.depth !== 1
        || !['library_worker', 'temporary_worker'].includes(child.role) || !['running', 'waiting'].includes(child.status)) {
        throw new Error('Owned worker authority changed');
      }
      const job = await requireBackgroundOwner(tx, { ...child, resultPayload: child.resultPayload as DelegateResultV1 }, grant, false);
      if (grant.nativeOwner !== undefined && (job.nativeOwner !== grant.nativeOwner || job.nativeOwnerFence !== job.fence)) {
        throw new Error('Background native owner changed');
      }
      const request = state.admittedRequest;
      const temporary = child.role === 'temporary_worker';
      if (!request || !request.nativeCallId || !request.nativeCallBranch.endsWith(
        `${temporary ? 'spawn_temporary_worker' : 'delegate_to_agent'}@${request.nativeCallId}`)
        || createHash('sha256').update(`${parent.id}:${request.nativeCallBranch}`).digest('hex').slice(0, 24) !== child.id
        || (!temporary && request.agentId !== state.rootContext.selected_agent_id) || (temporary && request.agentId !== undefined)) {
        throw new Error('Owned worker admitted request unavailable');
      }
      const digestInput = temporary ? { nativeCallId: request.nativeCallId, nativeCallBranch: request.nativeCallBranch,
        task: request.task, expectedOutput: request.expectedOutput ?? '', contextRefs: request.contextRefs ?? [] }
        : { agentId: request.agentId, task: request.task, expectedOutput: request.expectedOutput ?? '', contextRefs: request.contextRefs ?? [] };
      if (createHash('sha256').update(stableStringify(digestInput)).digest('hex') !== job.requestDigest) {
        throw new Error('Owned worker admitted request changed');
      }
      return { job, parent, child, state, request };
    });
  }

  async enqueue(executionId: string, requestDigest: string): Promise<RootBackgroundJob> {
    return this.db.transaction((tx) => this.enqueueInTransaction(tx, executionId, requestDigest));
  }

  async admit(input: RegisterExecutionInput, requestDigest: string): Promise<RootBackgroundJob> {
    return this.db.transaction(async (tx) => {
      await admitRootExecution(tx, input, true);
      return this.enqueueInTransaction(tx, input.executionId, requestDigest, true);
    });
  }

  private async enqueueInTransaction(tx: RootTransaction, executionId: string, requestDigest: string, allowReplay = false): Promise<RootBackgroundJob> {
      const [identity] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, executionId)).limit(1);
      if (!identity?.parentExecutionId) throw new Error('Background job requires an admitted worker');
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
      const [parent] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, identity.parentExecutionId))
        .limit(1).for('update');
      const [child] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, executionId)).limit(1).for('update');
      const rootState = (parent?.resultPayload as DelegateResultV1 | null)?.nativeState;
      const childState = (child?.resultPayload as DelegateResultV1 | null)?.nativeState;
      const [replay] = await tx.select().from(schema.rootBackgroundJobs)
        .where(eq(schema.rootBackgroundJobs.executionId, executionId)).limit(1);
      if (!conversation || !parent || parent.role !== 'root' || (!allowReplay || !replay) && !['running', 'waiting'].includes(parent.status)
        || !child || !['library_worker', 'temporary_worker'].includes(child.role) || child.depth !== 1
        || !['running', 'waiting'].includes(child.status) || conversation.rootWorkEpoch !== child.conversationEpoch
        || parent.conversationEpoch !== child.conversationEpoch || !rootState || !childState
        || rootState.rootContext.background_enabled !== true || !/^[0-9a-f]{64}$/.test(requestDigest)
        || childState.rootContext.delegate_request_digest !== requestDigest
        || !this.currentBinding(conversation, parent, rootState.actorId)) {
        throw new Error('Background job authority or immutable request unavailable');
      }
      if (replay) {
        if (replay.requestDigest !== requestDigest || replay.conversationId !== conversation.id
          || replay.parentExecutionId !== parent.id || replay.actorId !== rootState.actorId
          || replay.conversationEpoch !== conversation.rootWorkEpoch) throw new Error('Background job replay conflicts');
        return replay;
      }
      const limit = Number(rootState.rootContext.max_outstanding_background_jobs);
      const timeout = Number(rootState.rootContext.background_task_timeout_seconds);
      const maxAttempts = Number(rootState.rootContext.background_max_attempts);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5 || !Number.isSafeInteger(timeout)
        || timeout < 1 || timeout > 3600 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
        throw new Error('Invalid frozen background limits');
      }
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.rootBackgroundJobs)
        .where(and(eq(schema.rootBackgroundJobs.conversationId, parent.conversationId),
          inArray(schema.rootBackgroundJobs.status, ['queued', 'running', 'waiting', 'outcome_unknown'])));
      if (count >= limit) throw new Error('Background outstanding allowance exhausted');
      const deadline = Math.min(Number(rootState.scope.deadlineEpochMs), Date.now() + timeout * 1000);
      if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) throw new Error('Background deadline expired');
      const [job] = await tx.insert(schema.rootBackgroundJobs).values({ executionId, parentExecutionId: parent.id,
        conversationId: parent.conversationId, actorId: rootState.actorId, conversationEpoch: parent.conversationEpoch,
        requestDigest, maxAttempts, deadline: new Date(deadline), nativeSessionId: `background_${executionId}` }).returning();
      await tx.update(schema.rootExecutions).set({ resultPayload: { ...(child.resultPayload as DelegateResultV1),
        nativeState: { ...childState, backgroundJobId: executionId, sessionId: job.nativeSessionId, invocationId: null,
          scope: { ...childState.scope, nativeSessionId: job.nativeSessionId, nativeInvocationId: null } } }, updatedAt: new Date() })
        .where(eq(schema.rootExecutions.id, executionId));
      await tx.update(schema.rootExecutions).set({ resultPayload: { ...(parent.resultPayload as DelegateResultV1),
        nativeState: { ...rootState, hasBackgroundJobs: true } }, updatedAt: new Date() })
        .where(eq(schema.rootExecutions.id, parent.id));
      return job;
  }

  async claim(owner: string, leaseSeconds: number, limits: { global: number; perUser: number }): Promise<RootBackgroundJob | null> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner) || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300
      || !Number.isSafeInteger(limits.global) || limits.global < 1 || !Number.isSafeInteger(limits.perUser)
      || limits.perUser < 1 || limits.perUser > limits.global) throw new Error('Invalid trusted claim limits');
    return this.db.transaction(async (tx) => {
      // Serialize cross-conversation global/per-user admission, then follow
      // the conversation→ROOT→job order shared by Stop and native writers.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7391046)`);
      const eligible = or(
        and(eq(schema.rootBackgroundJobs.status, 'queued'), lte(schema.rootBackgroundJobs.availableAt, sql`clock_timestamp()`)),
        and(eq(schema.rootBackgroundJobs.status, 'running'), lte(schema.rootBackgroundJobs.leaseUntil, sql`clock_timestamp()`)),
      );
      const candidates = await tx.select().from(schema.rootBackgroundJobs).where(eligible)
        .orderBy(schema.rootBackgroundJobs.availableAt, schema.rootBackgroundJobs.executionId).limit(64);
      for (const candidate of candidates) {
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, candidate.conversationId)).limit(1).for('update');
      const [parent] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, candidate.parentExecutionId))
        .limit(1).for('update');
      const [job] = await tx.select().from(schema.rootBackgroundJobs).where(and(eq(schema.rootBackgroundJobs.executionId, candidate.executionId), eligible))
        .limit(1).for('update', { skipLocked: true });
      if (!job || !parent || !conversation) continue;
      const bindingChanged = !this.currentBinding(conversation, parent, job.actorId);
      if (bindingChanged || conversation.rootWorkEpoch !== job.conversationEpoch || job.deadline.getTime() <= Date.now() || job.attempts >= job.maxAttempts) {
        await tx.update(schema.rootBackgroundJobs).set({ status: bindingChanged || conversation.rootWorkEpoch !== job.conversationEpoch ? 'cancelled'
          : job.startedAt ? 'outcome_unknown' : 'failed', owner: null, leaseUntil: null, fence: job.fence + 1, updatedAt: new Date() })
          .where(eq(schema.rootBackgroundJobs.executionId, job.executionId));
        continue;
      }
      const validLeases = and(eq(schema.rootBackgroundJobs.status, 'running'), sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`);
      const [{ global }] = await tx.select({ global: sql<number>`count(*)::int` }).from(schema.rootBackgroundJobs).where(validLeases);
      const [{ perUser }] = await tx.select({ perUser: sql<number>`count(*)::int` }).from(schema.rootBackgroundJobs)
        .where(and(validLeases, eq(schema.rootBackgroundJobs.actorId, job.actorId)));
      const [{ perRoot }] = await tx.select({ perRoot: sql<number>`count(*)::int` }).from(schema.rootBackgroundJobs)
        .where(and(validLeases, eq(schema.rootBackgroundJobs.parentExecutionId, parent.id)));
      const state = (parent.resultPayload as DelegateResultV1 | null)?.nativeState;
      const rootLimit = Number(state?.rootContext.max_parallel_workers);
      const foreground = Object.keys(state?.workerPermits ?? {}).length;
      if (global >= limits.global) return null;
      if (perUser >= limits.perUser || !Number.isSafeInteger(rootLimit)
        || rootLimit < 1 || rootLimit > 8 || perRoot + foreground >= rootLimit) continue;
      const [claimed] = await tx.update(schema.rootBackgroundJobs).set({ status: 'running', owner,
        nativeOwner: null, nativeOwnerFence: null,
        fence: job.fence + 1, attempts: job.attempts + 1,
        leaseUntil: sql`LEAST(clock_timestamp() + ${leaseSeconds} * interval '1 second', ${schema.rootBackgroundJobs.deadline})`,
        updatedAt: new Date() }).where(and(eq(schema.rootBackgroundJobs.executionId, job.executionId),
          eq(schema.rootBackgroundJobs.fence, job.fence))).returning();
      return claimed ?? null;
      }
      return null;
    });
  }

  async heartbeat(grant: RootJobOwner, leaseSeconds: number): Promise<boolean> {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw new Error('Invalid lease duration');
    return this.withOwner(grant, async (tx) => {
    const rows = await tx.update(schema.rootBackgroundJobs).set({
      leaseUntil: sql`LEAST(clock_timestamp() + ${leaseSeconds} * interval '1 second', ${schema.rootBackgroundJobs.deadline})`,
      updatedAt: new Date(),
    }).where(and(this.owned(grant), sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`,
      sql`${schema.rootBackgroundJobs.deadline} > clock_timestamp()`,
      sql`EXISTS (SELECT 1 FROM conversation.conversations c WHERE c.id = ${schema.rootBackgroundJobs.conversationId}
        AND c.root_work_epoch = ${schema.rootBackgroundJobs.conversationEpoch})`)).returning({ id: schema.rootBackgroundJobs.executionId });
    return rows.length === 1;
    });
  }

  async markDispatched(grant: RootJobOwner): Promise<boolean> {
    return this.withOwner(grant, async (tx) => {
    const rows = await tx.update(schema.rootBackgroundJobs).set({
      startedAt: sql`COALESCE(${schema.rootBackgroundJobs.startedAt}, clock_timestamp())`, updatedAt: new Date(),
    }).where(and(this.owned(grant), sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`))
      .returning({ id: schema.rootBackgroundJobs.executionId });
    return rows.length === 1;
    });
  }

  private async withOwner(grant: RootJobOwner, update: (tx: RootTransaction) => Promise<boolean>): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx.select({ conversationId: schema.rootBackgroundJobs.conversationId }).from(schema.rootBackgroundJobs)
        .where(eq(schema.rootBackgroundJobs.executionId, grant.executionId)).limit(1);
      if (!identity) return false;
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
      const [job] = await tx.select().from(schema.rootBackgroundJobs).where(and(this.owned(grant),
        sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`,
        sql`${schema.rootBackgroundJobs.deadline} > clock_timestamp()`)).limit(1).for('update');
      if (!conversation || !job || conversation.rootWorkEpoch !== job.conversationEpoch) return false;
      const [parent] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, job.parentExecutionId)).limit(1);
      if (!parent || !this.currentBinding(conversation, parent, job.actorId)) return false;
      return update(tx);
    });
  }

  private currentBinding(conversation: typeof schema.conversations.$inferSelect,
    parent: typeof schema.rootExecutions.$inferSelect, actorId: string): boolean {
    return !conversation.isArchived && !conversation.isGroup && conversation.createdBy === actorId
      && conversation.rootAgentId === parent.rootAgentId && parent.conversationId === conversation.id
      && parent.conversationEpoch === conversation.rootWorkEpoch && parent.role === 'root' && parent.depth === 0
      && parent.status !== 'cancellation_requested'
      && (parent.resultPayload as DelegateResultV1 | null)?.nativeState?.actorId === actorId;
  }

  private owned(grant: RootJobOwner) {
    return and(eq(schema.rootBackgroundJobs.executionId, grant.executionId), eq(schema.rootBackgroundJobs.owner, grant.owner),
      eq(schema.rootBackgroundJobs.fence, grant.fence), eq(schema.rootBackgroundJobs.status, 'running'));
  }
  async controlInstance(): Promise<string> {
    const result = await this.db.execute(sql`SELECT instance_id FROM conversation.root_background_control_instance WHERE singleton=true`);
    if (result.rows.length !== 1 || typeof result.rows[0].instance_id !== 'string') throw new Error('Background control identity unavailable');
    return result.rows[0].instance_id;
  }

  queueInputs(conversationId: string, executionId: string, actorId: string, inputs: RootContinuationRequest['inputResponses']) {
    return queueBackgroundInputs(this.db, conversationId, executionId, actorId, inputs);
  }
}
