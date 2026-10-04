import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash } from 'node:crypto';
import { DRIZZLE_DB } from '../../../postgres/postgres.constants';
import * as schema from '../../../postgres/schema';
import { stableStringify } from '../../../agent/services/agent-execution-snapshot.service';
import type { DelegateResultV1, RootBackgroundJobOwnerV1 } from '../../root-work/root-work.types';
import { backgroundEventPayload, RootBackgroundEventProposal } from '../../root-work/root-background-event';
import { requireBackgroundOwner } from './root-background-owner';
import { RootResultService } from '../../root-work/root-result.service';

@Injectable()
export class RootBackgroundEventStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly results: RootResultService) {}

  async append(grant: RootBackgroundJobOwnerV1, requestDigest: string, events: RootBackgroundEventProposal[]) {
    if (!Array.isArray(events) || events.length < 1 || events.length > 20
      || Buffer.byteLength(JSON.stringify(events)) > 262144) throw new Error('Invalid bounded background event batch');
    return this.db.transaction(async (tx) => {
      const [identity] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, grant.executionId)).limit(1);
      if (!identity) throw new Error('Background event execution unavailable');
      await tx.select({ id: schema.conversations.id }).from(schema.conversations)
        .where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
      const [execution] = await tx.select().from(schema.rootExecutions)
        .where(eq(schema.rootExecutions.id, grant.executionId)).limit(1).for('update');
      const payload = execution.resultPayload as DelegateResultV1;
      const state = payload.nativeState!;
      const job = await requireBackgroundOwner(tx, { ...execution, resultPayload: payload }, grant);
      if (requestDigest !== job.requestDigest) throw new Error('Background event request binding changed');
      const acknowledgements: Array<{ eventId: string; sequence: string }> = [];
      let nextState = state;
      for (const event of events) {
        const publicPayload = backgroundEventPayload(event, job, state);
        const digest = createHash('sha256').update(stableStringify(publicPayload)).digest('hex');
        const [existing] = await tx.select().from(schema.rootBackgroundEvents).where(and(
          eq(schema.rootBackgroundEvents.executionId, execution.id), eq(schema.rootBackgroundEvents.eventId, event.eventId))).limit(1);
        if (existing && existing.payloadDigest !== digest) throw new Error('Background event replay conflicts');
        const row = existing ?? (await tx.insert(schema.rootBackgroundEvents).values({ executionId: execution.id,
          conversationId: job.conversationId, actorId: job.actorId, conversationEpoch: job.conversationEpoch,
          eventId: event.eventId, payloadDigest: digest, payload: publicPayload }).returning())[0];
        acknowledgements.push({ eventId: row.eventId, sequence: row.sequence.toString() });
        if (!existing) nextState = { ...nextState, backgroundEventSequence: row.sequence.toString() };
        if (!existing && 'nativeInvocationId' in publicPayload) {
          nextState = { ...nextState, invocationId: publicPayload.nativeInvocationId, pendingInputs: publicPayload.pendingInputs };
        }
      }
      await tx.update(schema.rootExecutions).set({ resultPayload: { ...payload, nativeState: nextState }, updatedAt: new Date() })
        .where(eq(schema.rootExecutions.id, execution.id));
      // Detect lease expiry after event/projection writes and roll back both.
      const live = await tx.select({ id: schema.rootBackgroundJobs.executionId }).from(schema.rootBackgroundJobs).where(and(
        eq(schema.rootBackgroundJobs.executionId, job.executionId), eq(schema.rootBackgroundJobs.owner, grant.owner),
        eq(schema.rootBackgroundJobs.fence, grant.fence), sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`,
        sql`${schema.rootBackgroundJobs.deadline} > clock_timestamp()`)).limit(1);
      if (live.length !== 1) throw new Error('Background event lease expired before commit');
      return acknowledgements;
    });
  }

  async replay(conversationId: string, actorId: string, epoch: number, after: string) {
    if (!/^[0-9]{1,20}$/.test(after) || BigInt(after) > 9223372036854775807n) throw new Error('Invalid durable event cursor');
    return this.db.transaction(async (tx) => {
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId)).limit(1).for('share');
      if (!conversation || conversation.createdBy !== actorId || conversation.rootWorkEpoch !== epoch
        || conversation.isArchived || conversation.isGroup) throw new Error('Background replay authority changed');
      const rows = await tx.select().from(schema.rootBackgroundEvents).where(and(
        eq(schema.rootBackgroundEvents.conversationId, conversationId), eq(schema.rootBackgroundEvents.actorId, actorId),
        eq(schema.rootBackgroundEvents.conversationEpoch, epoch), gt(schema.rootBackgroundEvents.sequence, BigInt(after)),
        sql`EXISTS (SELECT 1 FROM conversation.root_background_jobs j JOIN conversation.root_executions p ON p.id = j.parent_execution_id
          WHERE j.execution_id = ${schema.rootBackgroundEvents.executionId} AND p.root_agent_id IS NOT DISTINCT FROM ${conversation.rootAgentId}
            AND p.conversation_epoch = ${epoch})`))
        .orderBy(schema.rootBackgroundEvents.sequence).limit(100);
      for (const executionId of new Set(rows.map((row) => row.executionId))) {
        await this.results.authorizeBackgroundExecution(conversationId, executionId, actorId);
      }
      return rows.map((row) => ({ sequence: row.sequence.toString(), eventId: row.eventId, payload: row.payload }));
    });
  }
}
