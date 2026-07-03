import { mapPgTask, mapPgTaskResult } from './worky-electric.mapper';

describe('worky-electric.mapper', () => {
  it('maps a task row to Mongo $set + a task.updated event', () => {
    const { set, event } = mapPgTask(
      { id: 'pg-1', session_id: 's', title: 'T', description: 'd', lane: 'running',
        execution_state: 'running', priority: 'high', assignee_type: 'ephemeral_ai_agent',
        action_category: 'research', started_at: null, completed_at: null, updated_at: '2026-07-03T00:00:00Z' },
      'stream-1',
    );
    expect(set).toMatchObject({ externalId: 'pg-1', streamId: 'stream-1', title: 'T', lane: 'running', executionState: 'running' });
    expect(event.type).toBe('task.updated');
  });

  it('maps a completed task to a task.completed event', () => {
    const { event } = mapPgTask(
      { id: 'pg-1', session_id: 's', title: 'T', description: null, lane: 'done',
        execution_state: 'done', priority: null, assignee_type: null, action_category: null,
        started_at: null, completed_at: '2026-07-03T01:00:00Z', updated_at: '2026-07-03T01:00:00Z' },
      'stream-1',
    );
    expect(event.type).toBe('task.completed');
  });

  it('maps a task result keyed by taskId+version', () => {
    const r = mapPgTaskResult({ id: 'r1', task_id: 'pg-1', version: 2, status: 'ok', summary: 's', payload: null }, 'obj-1');
    expect(r).toMatchObject({ taskId: 'obj-1', version: 2 });
    expect(r.event.type).toBe('task.completed');
  });
});
