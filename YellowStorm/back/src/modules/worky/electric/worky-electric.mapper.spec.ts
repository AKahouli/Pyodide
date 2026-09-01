import { mapMessage, mapPlan, mapPlanStep, mapRole, mapStatusToLane, isKnownPlanStepStatus } from './worky-electric.mapper';
import { mapMessageComponent, mapPlanStepComponent, mapPlanStepArtifact } from './worky-electric.mapper';

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
        { id: 'pg-msg-1', session_id: 's', role: 'assistant', content: 'hello', turn_id: 'turn-1', created_at: '2026-07-03T00:00:00Z' },
        'stream-1',
      );
      expect(set).toMatchObject({ streamId: 'stream-1', externalId: 'pg-msg-1', turnId: 'turn-1', role: 'manager', content: 'hello' });
      expect(set.emittedAt).toEqual(new Date('2026-07-03T00:00:00Z'));
      expect(set).not.toHaveProperty('createdAt');
      expect(event).toMatchObject({ type: 'message.appended', payload: { id: 'pg-msg-1', turnId: 'turn-1', role: 'manager', content: 'hello' } });
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

    it('prefers the new title column for the card headline, keeps description as subtitle', () => {
      const { set } = mapPlanStep(
        {
          session_id: 's',
          step_id: 's1',
          ordinal: 0,
          status: 'running',
          title: 'Search Bitcoin price',
          description: 'Search the web for the current BTC price from reputable sources.',
        },
        'stream-1',
      );
      expect(set).toMatchObject({
        title: 'Search Bitcoin price',
        description: 'Search the web for the current BTC price from reputable sources.',
      });
    });

    it('for an ask step, uses question as the title fallback and as the subtitle', () => {
      const { set } = mapPlanStep(
        {
          session_id: 's',
          step_id: 's1',
          ordinal: 0,
          status: 'blocked',
          description: '',
          kind: 'ask',
          question: 'Which currency should I use?',
        },
        'stream-1',
      );
      expect(set).toMatchObject({
        title: 'Which currency should I use?',
        description: 'Which currency should I use?',
      });
    });

    it('maps plan_step result and blocked_reason into the $set', () => {
      const { set } = mapPlanStep(
        {
          session_id: 's',
          step_id: 'step-1',
          ordinal: 0,
          status: 'completed',
          description: 'd',
          result: 'the manager answer',
          blocked_reason: null,
        },
        'stream-1',
      );
      expect(set).toMatchObject({ result: 'the manager answer', blockedReason: null });
    });

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

    it('splits depends_on into dependsOnStepIds and passes wave through', () => {
      const { set } = mapPlanStep(
        {
          session_id: 's', step_id: 'step-3', ordinal: 2, status: 'pending',
          description: 'd', wave: 1, depends_on: 's1,s2',
        },
        'stream-1',
      );
      expect(set).toMatchObject({ wave: 1, dependsOnStepIds: ['s1', 's2'] });
    });

    it('defaults wave to null and dependsOnStepIds to [] when absent', () => {
      const { set } = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 0, status: 'pending', description: 'd' },
        'stream-1',
      );
      expect(set).toMatchObject({ wave: null, dependsOnStepIds: [] });
    });

    it('maps an unknown status to lane backlog / executionState not_started', () => {
      const { set } = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 1, status: 'some_weird_status', description: 'd' },
        'stream-1',
      );
      expect(set).toMatchObject({ lane: 'backlog', executionState: 'not_started' });
    });

    it('maps a non-empty assignee to a trimmed assigneeKey', () => {
      const { set } = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 1, status: 'running', description: 'd', assignee: '  Researcher ' },
        'stream-1',
      );
      expect(set).toMatchObject({ assigneeKey: 'Researcher' });
    });

    it('maps a missing or blank assignee to null', () => {
      const missing = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 1, status: 'running', description: 'd' },
        'stream-1',
      ).set;
      const blank = mapPlanStep(
        { session_id: 's', step_id: 'step-1', ordinal: 1, status: 'running', description: 'd', assignee: '   ' },
        'stream-1',
      ).set;
      expect(missing.assigneeKey).toBeNull();
      expect(blank.assigneeKey).toBeNull();
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

describe('mapMessageComponent', () => {
  it('maps a component row to a projection set + append event', () => {
    const { set, event } = mapMessageComponent(
      { session_id: 's1', message_id: 'msg-1', component_id: 'c-1', ordinal: 0, type: 'text', data: { content: 'hi' }, created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set).toMatchObject({
      streamId: 'stream-1',
      externalId: 'c-1',
      messageExternalId: 'msg-1',
      ordinal: 0,
      type: 'text',
      data: { content: 'hi' },
    });
    expect(event).toMatchObject({
      type: 'message.component.appended',
      payload: { messageExternalId: 'msg-1', componentId: 'c-1' },
    });
  });

  it('parses a JSON-string data payload (Electric jsonb-as-string)', () => {
    const { set } = mapMessageComponent(
      { session_id: 's1', message_id: 'msg-1', component_id: 'c-2', ordinal: 1, type: 'code', data: '{"content":"x","language":"ts"}', created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set.data).toEqual({ content: 'x', language: 'ts' });
  });
});

describe('mapPlanStepComponent', () => {
  it('maps a step component row to a set + task.component event', () => {
    const { set, event } = mapPlanStepComponent(
      { session_id: 's1', step_id: 'step-1', component_id: 'c-9', ordinal: 2, type: 'artifact', data: { file_path: 'k/1', filename: 'a.png' }, created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set).toMatchObject({ streamId: 'stream-1', externalId: 'c-9', stepExternalId: 'step-1', ordinal: 2, type: 'artifact', data: { file_path: 'k/1', filename: 'a.png' } });
    expect(event).toMatchObject({ type: 'task.component.appended', payload: { stepExternalId: 'step-1', componentId: 'c-9' } });
  });
});

describe('mapPlanStepArtifact', () => {
  it('maps an artifact row to a set + task.artifact event', () => {
    const { set, event } = mapPlanStepArtifact(
      { session_id: 's1', step_id: 'step-1', artifact_id: 'a-1', file_path: 'key/abc', filename: 'report.pdf', artifact_kind: 'document', mime_type: 'application/pdf', size: 1234, created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set).toMatchObject({
      streamId: 'stream-1',
      externalId: 'a-1',
      stepExternalId: 'step-1',
      filePath: 'key/abc',
      filename: 'report.pdf',
      artifactKind: 'document',
      mimeType: 'application/pdf',
      size: 1234,
    });
    expect(event).toMatchObject({ type: 'task.artifact.appended', payload: { stepExternalId: 'step-1', artifactId: 'a-1' } });
  });
});
