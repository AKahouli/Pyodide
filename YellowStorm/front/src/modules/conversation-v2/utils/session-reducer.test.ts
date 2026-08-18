import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../types';
import { isTurnOpen, shouldApplyTerminalEvent } from './session-reducer';

describe('isTurnOpen', () => {
  it('returns false when the last user prompt already has a done event', () => {
    const events: AgentEvent[] = [
      { type: 'message', event_id: 'u1', timestamp: 1, role: 'user', content: 'build' },
      { type: 'done', event_id: 'd1', timestamp: 2 },
    ];
    expect(isTurnOpen(events)).toBe(false);
  });

  it('returns true when the latest user prompt has no terminal event yet', () => {
    const events: AgentEvent[] = [
      { type: 'message', event_id: 'u1', timestamp: 1, role: 'user', content: 'build' },
      { type: 'done', event_id: 'd1', timestamp: 2 },
      { type: 'message', event_id: 'u2', timestamp: 3, role: 'user', content: 'modify' },
      { type: 'tool', event_id: 't1', timestamp: 4, tool_call_id: 'tc1', name: 'mcp', status: 'calling', function: 'write', args: {} },
    ];
    expect(isTurnOpen(events)).toBe(true);
  });
});

describe('shouldApplyTerminalEvent', () => {
  it('rejects a done event older than the latest user message sequence', () => {
    const events: AgentEvent[] = [
      { type: 'message', event_id: 'u1', timestamp: 1, role: 'user', content: 'first', sequence: 10 },
      { type: 'done', event_id: 'd1', timestamp: 2, sequence: 20 },
      { type: 'message', event_id: 'u2', timestamp: 3, role: 'user', content: 'second', sequence: 30 },
    ];
    const staleDone: AgentEvent = { type: 'done', event_id: 'd-old', timestamp: 4, sequence: 25 };
    expect(shouldApplyTerminalEvent(events, staleDone)).toBe(false);
  });

  it('accepts a done event after the latest user message sequence', () => {
    const events: AgentEvent[] = [
      { type: 'message', event_id: 'u1', timestamp: 1, role: 'user', content: 'second', sequence: 30 },
    ];
    const done: AgentEvent = { type: 'done', event_id: 'd2', timestamp: 2, sequence: 40 };
    expect(shouldApplyTerminalEvent(events, done)).toBe(true);
  });
});
