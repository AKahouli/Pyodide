import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';

import { autosaveMachine } from '@/modules/playbook/machines/autosave/autosaveMachine';

describe('autosaveMachine', () => {
  it('debounces a local change before saving delta', () => {
    const actor = createActor(autosaveMachine).start();

    actor.send({ type: 'LOCAL_CHANGE', dirtyVersion: 1 });
    actor.send({ type: 'DEBOUNCE_ELAPSED' });

    expect(actor.getSnapshot().value).toBe('savingDelta');
  });

  it('returns to dirty when another change lands during a save', () => {
    const actor = createActor(autosaveMachine).start();

    actor.send({ type: 'LOCAL_CHANGE', dirtyVersion: 1 });
    actor.send({ type: 'SAVE_NOW', reason: 'manual' });
    actor.send({ type: 'LOCAL_CHANGE', dirtyVersion: 2 });
    actor.send({ type: 'DELTA_SAVE_SUCCEEDED' });

    expect(actor.getSnapshot().value).toBe('dirty');
  });

  it('falls back from delta to full save when requested', () => {
    const actor = createActor(autosaveMachine).start();

    actor.send({ type: 'LOCAL_CHANGE', dirtyVersion: 1 });
    actor.send({ type: 'SAVE_NOW', reason: 'autosave' });
    actor.send({ type: 'DELTA_SAVE_FAILED', fallbackToFull: true });

    expect(actor.getSnapshot().value).toBe('savingFull');
  });

  it('enters conflict and only resets from server explicitly', () => {
    const actor = createActor(autosaveMachine).start();

    actor.send({ type: 'LOCAL_CHANGE', dirtyVersion: 1 });
    actor.send({ type: 'SAVE_NOW', reason: 'autosave' });
    actor.send({ type: 'CONFLICT_DETECTED', errorCode: 'CONFLICT' });
    actor.send({ type: 'SAVE_NOW', reason: 'manual' });

    expect(actor.getSnapshot().value).toBe('conflict');

    actor.send({ type: 'RESET_FROM_SERVER' });

    expect(actor.getSnapshot().value).toBe('clean');
  });

  it('uses backoff for retriable failures', () => {
    const actor = createActor(autosaveMachine).start();

    actor.send({ type: 'LOCAL_CHANGE', dirtyVersion: 1 });
    actor.send({ type: 'SAVE_NOW', reason: 'autosave' });
    actor.send({ type: 'DELTA_SAVE_FAILED', errorCode: 'RATE_LIMITED', backoffUntil: Date.now() + 5000 });

    expect(actor.getSnapshot().value).toBe('backingOff');

    actor.send({ type: 'RETRY_TIMER_ELAPSED' });

    expect(actor.getSnapshot().value).toBe('dirty');
  });
});
