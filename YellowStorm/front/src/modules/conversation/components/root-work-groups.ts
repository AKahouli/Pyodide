import type { RootWorkSnapshot } from '../types';
export type WorkJob = RootWorkSnapshot['jobs'][number];
export const isActiveWork = (job: WorkJob) => ['queued', 'running', 'waiting'].includes(job.status);
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
