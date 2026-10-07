import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as schema from '../../../postgres/schema';
import type { RootNativeState } from '../../root-work/root-work.types';
import type { RootControlTransaction } from './root-background-owner';

/** Called only while holding the conversation and original ROOT locks. */
export async function sealRootScheduling(tx: RootControlTransaction, executionId: string,
  state: RootNativeState): Promise<RootNativeState> {
  if (!state.hasBackgroundJobs || state.schedulingSeal) return state;
  const children = await tx.select({ executionId: schema.rootExecutions.id, role: schema.rootExecutions.role })
    .from(schema.rootExecutions).where(and(eq(schema.rootExecutions.parentExecutionId, executionId),
      eq(schema.rootExecutions.conversationEpoch, state.scope.conversationEpoch)));
  const members = new Map(children.filter((child) => child.role !== 'followup')
    .map((child) => [child.executionId, child.role]));
  for (const manifest of state.fanoutManifests ?? []) {
    for (const item of manifest.items) members.set(item.executionId,
      manifest.target.kind === 'temporary' ? 'temporary_worker' : 'library_worker');
  }
  const resultManifest = [...members].sort(([a], [b]) => a.localeCompare(b))
    .map(([executionId, role]) => ({ executionId, role }));
  const digest = createHash('sha256').update(JSON.stringify(resultManifest)).digest('hex');
  return { ...state, schedulingSeal: { sealedAt: new Date().toISOString(), resultManifest, digest,
    followupExecutionId: createHash('sha256').update(`${executionId}:${digest}:followup`).digest('hex').slice(0, 24) } };
}
