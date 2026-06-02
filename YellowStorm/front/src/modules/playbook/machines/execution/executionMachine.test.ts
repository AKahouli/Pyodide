import { afterEach, describe, expect, it } from 'vitest';
import { createActor } from 'xstate';

import {
  getExecutionActor,
  resetExecutionActorRegistry,
  sendExecutionLifecycleEvent,
} from '@/modules/playbook/machines/execution/executionActorRegistry';
import {
  executionMachine,
  getExecutionLifecycleFlags,
} from '@/modules/playbook/machines/execution/executionMachine';

describe('executionMachine', () => {
  afterEach(() => {
    resetExecutionActorRegistry();
  });

  it('moves from accepted queue state to running when execution starts', () => {
    const actor = createActor(executionMachine).start();

    actor.send({ type: 'START_ACCEPTED', executionId: 'exec-1', playbookId: 'flow-1', status: 'queued' });
    expect(actor.getSnapshot().value).toBe('queued');

    actor.send({ type: 'EXECUTION_STARTED' });

    expect(actor.getSnapshot().value).toBe('running');
  });

  it('deduplicates terminal events by ignoring later terminal transitions', () => {
    const actor = createActor(executionMachine).start();

    actor.send({ type: 'START_ACCEPTED', executionId: 'exec-1', status: 'running' });
    actor.send({ type: 'EXECUTION_COMPLETED' });
    actor.send({ type: 'EXECUTION_FAILED' });
    actor.send({ type: 'EXECUTION_CANCELLED' });

    expect(actor.getSnapshot().value).toBe('completed');
  });

  it('allows cancel while queued', () => {
    const actor = createActor(executionMachine).start();

    actor.send({ type: 'START_ACCEPTED', executionId: 'exec-1', status: 'queued' });
    actor.send({ type: 'CANCEL_REQUESTED' });
    actor.send({ type: 'CANCEL_ACCEPTED' });

    expect(actor.getSnapshot().value).toBe('cancelled');
  });

  it('models interrupt and resume explicitly', () => {
    const actor = createActor(executionMachine).start();

    actor.send({ type: 'START_ACCEPTED', executionId: 'exec-1', status: 'running' });
    actor.send({ type: 'INTERRUPT_RECEIVED' });
    expect(getExecutionLifecycleFlags(actor.getSnapshot().value as 'interrupted')).toMatchObject({
      canResume: true,
      isWaitingForHuman: true,
    });

    actor.send({ type: 'RESUME_REQUESTED' });
    actor.send({ type: 'RESUME_ACCEPTED' });

    expect(actor.getSnapshot().value).toBe('running');
  });

  it('ignores resume after the execution is already terminal', () => {
    const actor = createActor(executionMachine).start();

    actor.send({ type: 'START_ACCEPTED', executionId: 'exec-1', status: 'running' });
    actor.send({ type: 'EXECUTION_COMPLETED' });
    actor.send({ type: 'RESUME_REQUESTED' });
    actor.send({ type: 'RESUME_ACCEPTED' });

    expect(actor.getSnapshot().value).toBe('completed');
  });

  it('routes registry events to one actor per execution id', () => {
    sendExecutionLifecycleEvent('exec-1', { type: 'START_ACCEPTED', executionId: 'exec-1', status: 'queued' });
    sendExecutionLifecycleEvent('exec-1', { type: 'EXECUTION_STARTED' });

    expect(getExecutionActor('exec-1').getSnapshot().value).toBe('running');
  });
});
