import { expect, it } from 'vitest';
import { groupRootWork, type WorkJob } from './root-work-groups';
const job: WorkJob = { executionId: 'worker', parentExecutionId: 'request', role: 'temporary_worker', status: 'completed', task: 'Compare documents', createdAt: '', deadline: '' };
it('groups synthesis with workers and shows preparing until publication completes', () => {
  const groups = groupRootWork([job, { ...job, executionId: 'followup', role: 'followup', status: 'running', task: undefined }]);
  expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ state: 'preparing', title: 'Compare documents', active: true });
});
it('prioritizes failed or uncertain work over running and completed work', () => {
  const groups = groupRootWork([job, { ...job, parentExecutionId: 'active', status: 'running' }, { ...job, parentExecutionId: 'review', status: 'outcome_unknown' }]);
  expect(groups.map((group) => group.id)).toEqual(['review', 'active', 'request']);
});
it('does not label a partially cancelled request as wholly cancelled', () => {
  const groups = groupRootWork([job, { ...job, executionId: 'cancelled', status: 'cancelled' }]);
  expect(groups[0].state).toBe('partial');
});

