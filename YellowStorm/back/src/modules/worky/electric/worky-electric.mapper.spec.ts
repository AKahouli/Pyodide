import { mapMessage, mapPlan, mapPlanStep, mapRole, mapStatusToLane, isKnownPlanStepStatus } from './worky-electric.mapper';

describe('worky-electric.mapper', () => {
  describe('mapRole / mapMessage', () => {
    it('maps assistant -> manager', () => {
      expect(mapRole('assistant')).toBe('manager');
    });

    it('maps manager -> manager', () => {
      expect(mapRole('manager')).toBe('manager');
    });

    it('maps user/owner/human -> owner', () => {
      expect(mapRole('user')).toBe('owner');
      expect(mapRole('owner')).toBe('owner');
      expect(mapRole('human')).toBe('owner');
    });

    it('maps system -> system', () => {
      expect(mapRole('system')).toBe('system');
    });

    it('maps an unknown role -> manager', () => {
      expect(mapRole('bogus')).toBe('manager');
      expect(mapRole('')).toBe('manager');
    });

    it('maps a message row to Mongo $set with externalId + a message.appended event', () => {
      const { set, event } = mapMessage(
        { id: 'pg-msg-1', session_id: 's', role: 'assistant', content: 'hello', created_at: '2026-07-03T00:00:00Z' },
        'stream-1',
      );
      expect(set).toMatchObject({ streamId: 'stream-1', externalId: 'pg-msg-1', role: 'manager', content: 'hello' });
      expect(set.emittedAt).toEqual(new Date('2026-07-03T00:00:00Z'));
      expect(set).not.toHaveProperty('createdAt');
      expect(event).toMatchObject({ type: 'message.appended', payload: { id: 'pg-msg-1', role: 'manager', content: 'hello' } });
    });

    it('maps owner role through unchanged', () => {
      const { set } = mapMessage(
        { id: 'pg-msg-2', session_id: 's', role: 'user', content: 'hi', created_at: '2026-07-03T00:00:00Z' },
        'stream-1',
      );
      expect(set).toMatchObject({ role: 'owner' });
    });
  });

  describe('mapStatusToLane / isKnownPlanStepStatus / mapPlanStep', () => {
    it('maps known statuses to the expected lane', () => {
      expect(mapStatusToLane('pending')).toBe('backlog');
      expect(mapStatusToLane('running')).toBe('running');
      expect(mapStatusToLane('completed')).toBe('done');
      expect(mapStatusToLane('failed')).toBe('failed');
      expect(mapStatusToLane('cancelled')).toBe('canceled');
    });

    it('maps an unknown status to backlog and flags it as unknown', () => {
      expect(mapStatusToLane('some_weird_status')).toBe('backlog');
      expect(isKnownPlanStepStatus('some_weird_status')).toBe(false);
      expect(isKnownPlanStepStatus('running')).toBe(true);
    });

    it('maps a plan_step row to Mongo $set + a task.updated event for a non-terminal lane', () => {
      const { set, event } = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 2, status: 'in_progress', description: 'Do the thing' },
        'stream-1',
      );
      expect(set).toMatchObject({
        streamId: 'stream-1',
        externalId: 'step-1',
        title: 'Do the thing',
        description: 'Do the thing',
        ordinal: 2,
        lane: 'running',
        executionState: 'running',
      });
      expect(event).toMatchObject({ type: 'task.updated', payload: { externalId: 'step-1', lane: 'running' } });
    });

    it.each(['completed', 'failed', 'cancelled'])(
      'emits a task.completed event for terminal status %s',
      (status) => {
        const { event } = mapPlanStep(
          { session_id: 's', step_id: 'step-1', ordinal: 1, status, description: 'd' },
          'stream-1',
        );
        expect(event.type).toBe('task.completed');
      },
    );

    it('falls back to "Step {ordinal}" as the title when description is empty', () => {
      const { set } = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 5, status: 'pending', description: '' },
        'stream-1',
      );
      expect(set).toMatchObject({ title: 'Step 5' });
    });

    it('falls back to "Step {ordinal}" when description is only whitespace', () => {
      const { set } = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 3, status: 'pending', description: '   ' },
        'stream-1',
      );
      expect(set).toMatchObject({ title: 'Step 3' });
    });

    it('maps an unknown status to lane backlog / executionState not_started', () => {
      const { set } = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 1, status: 'some_weird_status', description: 'd' },
        'stream-1',
      );
      expect(set).toMatchObject({ lane: 'backlog', executionState: 'not_started' });
    });
  });

  describe('mapPlan', () => {
    it('passes the raw status through and emits a stream.updated event', () => {
      const { set, event } = mapPlan({ session_id: 's', title: 'My Plan', status: 'completed' }, 'stream-1');
      expect(set).toEqual({ streamId: 'stream-1', title: 'My Plan', status: 'completed' });
      expect(event).toMatchObject({
        type: 'stream.updated',
        payload: { plan: { title: 'My Plan', status: 'completed' } },
      });
    });
  });
});
