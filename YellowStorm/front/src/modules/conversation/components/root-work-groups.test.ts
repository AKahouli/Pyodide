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
it('does not count an uncertain batch as working or count its coordinator as a fifth item', () => {
  const group = groupRootWork([{ ...job, role: 'fanout_driver', status: 'outcome_unknown', fanoutItems: [
    { executionId: 'one', status: 'completed' }, { executionId: 'two', status: 'completed' },
    { executionId: 'three', status: 'outcome_unknown' }, { executionId: 'four', status: 'outcome_unknown' },
  ] }])[0];
  expect(group).toMatchObject({ active: false, attention: true, state: 'outcome_unknown',
    counts: { total: 4, completed: 2, unresolved: 2, running: 0 } });
});
it('does not label a partially cancelled request as wholly cancelled', () => {
  const groups = groupRootWork([job, { ...job, executionId: 'cancelled', status: 'cancelled' }]);
  expect(groups[0].state).toBe('partial');
});
it('keeps a failed fanout item visible after coordinator and synthesis completion', () => {
  const groups = groupRootWork([{ ...job, role: 'fanout_driver', fanoutItems: [
    { executionId: 'one', status: 'completed' }, { executionId: 'two', status: 'failed' }],
  }, { ...job, executionId: 'followup', role: 'followup' }]);
  expect(groups[0]).toMatchObject({ state: 'failed', attention: true });
});
it('counts a stopped batch with completed leaves as partial even after final answer preparation', () => {
  const groups = groupRootWork([{ ...job, role: 'fanout_driver', status: 'cancelled', fanoutItems: [
    { executionId: 'one', status: 'completed' }, { executionId: 'two', status: 'cancelled' }],
  }, { ...job, executionId: 'followup', role: 'followup' }]);
  expect(groups[0].state).toBe('partial');
});

