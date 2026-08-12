import { describe, it, expect, vi } from 'vitest';
import { milestoneText, attachMilestoneInjector } from './milestoneInjector';
import * as sse from '../stream/sse';
import type { WorkyEvent } from '../types';

describe('milestoneText', () => {
  it('maps plan creation', () => {
    expect(milestoneText({ type: 'plan.version.created', data: {} })).toContain('[worky update:');
  });
  it('maps a manager final answer', () => {
    const t = milestoneText({ type: 'message.appended', data: { payload: { role: 'manager', content: 'Done: found 3.' } } });
    expect(t).toContain('Done: found 3.');
  });
  it('ignores an owner message echo', () => {
    expect(milestoneText({ type: 'message.appended', data: { payload: { role: 'owner', content: 'hi' } } })).toBeNull();
  });
  it('maps task completion', () => {
    expect(milestoneText({ type: 'task.completed', data: {} })).toContain('[worky update:');
  });
  it('ignores noisy token events', () => {
    expect(milestoneText({ type: 'assistant_token', data: {} })).toBeNull();
  });
});

describe('attachMilestoneInjector', () => {
  it('injects only milestone events and returns an unsubscribe', () => {
    let handler!: (e: WorkyEvent) => void;
    const unsub = vi.fn();
    vi.spyOn(sse, 'subscribeToStreamEvents').mockImplementation((_id, onEvent) => {
      handler = onEvent;
      return unsub;
    });
    const inject = vi.fn();

    const off = attachMilestoneInjector('s1', inject);
    handler({ type: 'assistant_token', data: {} });
    handler({ type: 'task.completed', data: {} });
    expect(inject).toHaveBeenCalledTimes(1);
    off();
    expect(unsub).toHaveBeenCalled();
  });
});
