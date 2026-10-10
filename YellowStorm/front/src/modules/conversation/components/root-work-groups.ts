import type { RootWorkSnapshot } from '../types';
export type WorkJob = RootWorkSnapshot['jobs'][number];
export const isActiveWork = (job: WorkJob) => ['queued', 'running', 'waiting', 'outcome_unknown'].includes(job.status);
export function groupRootWork(jobs: WorkJob[]) {
  const groups = new Map<string, WorkJob[]>();
  for (const job of jobs) {
    const key = job.parentExecutionId || job.executionId;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups].map(([id, children]) => {
    const attention = children.some((job) => ['outcome_unknown', 'failed'].includes(job.status));
    const active = children.some(isActiveWork);
    const preparing = children.some((job) => job.role === 'followup' && isActiveWork(job));
    const state: WorkJob['status'] | 'preparing' | 'partial' = attention ? children.some((job) => job.status === 'outcome_unknown') ? 'outcome_unknown' : 'failed'
      : preparing ? 'preparing' : active ? children.some((job) => job.status === 'running') ? 'running' : children.some((job) => job.status === 'waiting') ? 'waiting' : 'queued'
      : children.every((job) => job.status === 'cancelled') ? 'cancelled' : children.some((job) => job.status === 'cancelled') ? 'partial' : 'completed';
    return { id, jobs: children, attention, active, state,
      title: children.find((job) => job.role !== 'followup' && job.task)?.task,
      publicationMessageId: children.find((job) => job.publicationMessageId)?.publicationMessageId };
  }).sort((a, b) => Number(b.attention) - Number(a.attention) || Number(b.active) - Number(a.active));
}
