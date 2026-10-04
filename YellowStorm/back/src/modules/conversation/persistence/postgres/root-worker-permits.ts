import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../postgres/schema';
import type { DelegateResultV1 } from '../../root-work/root-work.types';

/** Shared ROOT slots, independent of nonterminal/waiting execution counts.
 * Owners cannot be replaced by elapsed lease time: foreground code releases
 * in finally, and an abandoned ROOT must reach its deadline or Stop barrier.
 */
export async function updateWorkerPermit(db: NodePgDatabase<typeof schema>, parentId: string,
  childId: string, owner: string, operation: 'acquire' | 'release'): Promise<boolean> {
  if (!/^[0-9a-f]{24}$/.test(parentId) || !/^[0-9a-f]{24}$/.test(childId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) throw new Error('Invalid worker permit identity');
  return db.transaction(async (tx) => {
    const [identity] = await tx.select({ conversationId: schema.rootExecutions.conversationId })
      .from(schema.rootExecutions).where(eq(schema.rootExecutions.id, parentId)).limit(1);
    if (!identity) return false;
    const [conversation] = await tx.select({ epoch: schema.conversations.rootWorkEpoch })
      .from(schema.conversations).where(eq(schema.conversations.id, identity.conversationId)).limit(1).for('update');
    const [parent] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, parentId))
      .limit(1).for('update');
    const payload = parent?.resultPayload as DelegateResultV1 | null;
    const state = payload?.nativeState;
    if (!parent || parent.role !== 'root' || parent.depth !== 0 || !state) return false;
    const permits = { ...(state.workerPermits ?? {}) };
    if (operation === 'release') {
      if (permits[childId] !== owner) return false;
      delete permits[childId];
    } else {
      const [child] = await tx.select().from(schema.rootExecutions).where(eq(schema.rootExecutions.id, childId)).limit(1);
      const duration = Number(state.rootContext.max_work_group_duration_seconds);
      if (!conversation || conversation.epoch !== parent.conversationEpoch
        || !['running', 'waiting'].includes(parent.status) || !child
        || child.parentExecutionId !== parentId || child.conversationEpoch !== parent.conversationEpoch
        || !['library_worker', 'temporary_worker'].includes(child.role) || !['running', 'waiting'].includes(child.status)
        || !Number.isSafeInteger(duration) || duration < 1 || Date.now() >= parent.createdAt.getTime() + duration * 1000) {
        return false;
      }
      if (permits[childId]) return permits[childId] === owner;
      const limit = Number(state.rootContext.max_parallel_workers);
      let background = 0;
      if (state.hasBackgroundJobs) {
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.rootBackgroundJobs)
          .where(and(eq(schema.rootBackgroundJobs.parentExecutionId, parentId), eq(schema.rootBackgroundJobs.status, 'running'),
            sql`${schema.rootBackgroundJobs.leaseUntil} > clock_timestamp()`));
        background = count;
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8 || Object.keys(permits).length + background >= limit) return false;
      permits[childId] = owner;
    }
    await tx.update(schema.rootExecutions).set({ resultPayload: { ...payload,
      nativeState: { ...state, workerPermits: permits } }, updatedAt: new Date() }).where(eq(schema.rootExecutions.id, parentId));
    return true;
  });
}
