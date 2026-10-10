import { rootResultCounts } from './root-result-counts';
it('counts user items without including stopped coordinators or completed synthesis', () => {
  expect(rootResultCounts([{ role: 'fanout_driver', status: 'cancelled' },
    { role: 'temporary_worker', status: 'completed' }, { role: 'temporary_worker', status: 'completed' },
    { role: 'temporary_worker', status: 'cancelled' }, { role: 'temporary_worker', status: 'cancelled' },
    { role: 'followup', status: 'completed' }])).toEqual({ requested: 4, completed: 2, cancelled: 2, failed: 0, outcome_unknown: 0, not_started: 0 });
});
