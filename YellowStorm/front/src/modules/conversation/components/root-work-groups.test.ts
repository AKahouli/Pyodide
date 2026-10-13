import { expect, it } from 'vitest';
import { groupRootWork, groupHeaderState, workGroupWorkers, snapshotWork, type WorkJob } from './root-work-groups';
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
it('classifies trusted worker kinds without counting coordinators or final answer synthesis', () => {
  const workers = workGroupWorkers([{ ...job, role: 'fanout_driver', fanoutItems: [
    { executionId: 'temporary', status: 'running', workerRole: 'temporary_worker' },
    { executionId: 'specialist', status: 'completed', workerRole: 'library_worker' },
  ] }, { ...job, executionId: 'followup', role: 'followup' }]);
  expect(workers.map((worker) => worker.role)).toEqual(['temporary_worker', 'library_worker']);
});
it('keeps stopping foreground workers active and clears them with a new empty snapshot', () => {
  const snapshot = { epoch: 1, watermark: '0', stopRequestId: 'stop', jobs: [], foregroundWorkers: [
    { ...job, mode: 'foreground' as const, status: 'cancellation_requested' as const },
  ] };
  expect(groupRootWork(snapshotWork(snapshot))[0]).toMatchObject({ state: 'cancellation_requested', active: true });
  expect(snapshotWork({ ...snapshot, epoch: 2, foregroundWorkers: [] })).toEqual([]);
});
it('does not replace a successful foreground reply header with a failed leaf state', () => {
  const jobs = [{ ...job, mode: 'foreground' as const }, { ...job, executionId: 'failed', mode: 'foreground' as const, status: 'failed' as const }];
  const group = groupRootWork(jobs)[0];
  expect(group.attention).toBe(true);
  expect(groupHeaderState(group)).toBeUndefined();
  expect(groupHeaderState(groupRootWork([...jobs, { ...job, mode: 'foreground', executionId: 'active', status: 'running' }])[0])).toBe('running');
});

