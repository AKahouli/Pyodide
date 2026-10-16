import type { RootWorkSnapshot } from '../types';
export type WorkJob = RootWorkSnapshot['jobs'][number];
export const isActiveWork = (job: WorkJob) => ['queued', 'running', 'waiting', 'cancellation_requested'].includes(job.status);
export const snapshotWork = (snapshot?: RootWorkSnapshot) => [...(snapshot?.jobs ?? []), ...(snapshot?.foregroundWorkers ?? [])];
export function workerStatus(status: string): WorkJob['status'] {
  return (['queued', 'running', 'waiting', 'outcome_unknown', 'completed', 'failed', 'cancelled', 'cancellation_requested', 'not_started'] as const)
    .find((known) => known === status) ?? 'outcome_unknown';
}
export function workGroupWorkers(jobs: WorkJob[]) {
  const workers = jobs.flatMap((job) => {
    if (job.role === 'followup') return [];
    if (job.fanoutItems?.length) return job.fanoutItems.map((item) => ({ executionId: item.executionId, role: item.workerRole,
      task: item.label, status: workerStatus(item.status), mode: job.mode ?? 'background' }));
    if (job.role === 'fanout_driver') return [];
    return [{ executionId: job.executionId, role: job.role, task: job.task, status: job.status, mode: job.mode ?? 'background' }];
  });
  return [...new Map(workers.map((worker) => [worker.executionId, worker])).values()];
}
export function groupRootWork(jobs: WorkJob[]) {
  const groups = new Map<string, WorkJob[]>();
  for (const job of jobs) {
    const key = job.parentExecutionId || job.executionId;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups].map(([id, children]) => {
    const itemStatuses = children.filter((job) => job.role !== 'followup').flatMap((job) => job.fanoutItems?.length
      ? job.fanoutItems.map((item) => item.status) : [job.status]);
    const attention = [...children.map((job) => job.status), ...itemStatuses].some((status) => ['outcome_unknown', 'failed'].includes(status));
    const active = children.some(isActiveWork);
    const preparing = children.some((job) => job.role === 'followup' && isActiveWork(job));
    const state: WorkJob['status'] | 'preparing' | 'partial' = attention ? [...children.map((job) => job.status), ...itemStatuses].includes('outcome_unknown') ? 'outcome_unknown' : 'failed'
      : children.some((job) => job.status === 'cancellation_requested') ? 'cancellation_requested'
      : preparing ? 'preparing' : active ? children.some((job) => job.status === 'running') ? 'running' : children.some((job) => job.status === 'waiting') ? 'waiting' : 'queued'
      : itemStatuses.length && itemStatuses.every((status) => ['cancelled', 'not_started'].includes(status)) ? 'cancelled'
      : itemStatuses.some((status) => ['cancelled', 'not_started'].includes(status)) ? 'partial' : 'completed';
    const counts = { total: itemStatuses.length, completed: itemStatuses.filter((status) => status === 'completed').length,
      unresolved: itemStatuses.filter((status) => status === 'outcome_unknown').length,
      running: itemStatuses.filter((status) => status === 'running').length,
      queued: itemStatuses.filter((status) => status === 'queued').length };
    return { id, jobs: children, attention, active, state, counts,
      title: children.find((job) => job.role !== 'followup' && job.task)?.task,
      publicationMessageId: children.find((job) => job.publicationMessageId)?.publicationMessageId };
  }).sort((a, b) => Number(b.attention) - Number(a.attention) || Number(b.active) - Number(a.active));
}

export function groupHeaderState(group?: ReturnType<typeof groupRootWork>[number]) {
  if (!group) return undefined;
  if (group.jobs.every((job) => job.mode === 'foreground')) {
    if (!group.active) return undefined;
    return group.jobs.some((job) => job.status === 'cancellation_requested') ? 'cancellation_requested' as const
      : group.jobs.some((job) => job.status === 'running') ? 'running' as const
      : group.jobs.some((job) => job.status === 'waiting') ? 'waiting' as const : 'queued' as const;
  }
  return group.state !== 'completed' && group.state !== 'cancelled' && group.state !== 'partial' ? group.state : undefined;
}
