import { describe, it, expect } from 'vitest';
import { deriveAgentStatus, groupTasksByAgent, agentInitials } from './agentModel';
import type { WorkyTask } from '../types';
import type { Agent } from '../../agent/types';

const task = (o: Partial<WorkyTask>): WorkyTask =>
  ({ id: Math.random().toString(), title: 't', lane: 'backlog', assigneeKey: 'a', ...o } as WorkyTask);

describe('deriveAgentStatus', () => {
  it('is working when any task is running', () => {
    expect(deriveAgentStatus([task({ lane: 'done' }), task({ lane: 'running' })])).toBe('working');
  });
  it('is blocked when blocked and none running', () => {
    expect(deriveAgentStatus([task({ lane: 'blocked' }), task({ lane: 'done' })])).toBe('blocked');
  });
  it('is done when all terminal-done', () => {
    expect(deriveAgentStatus([task({ lane: 'done' }), task({ lane: 'done' })])).toBe('done');
  });
  it('is idle otherwise', () => {
    expect(deriveAgentStatus([task({ lane: 'backlog' })])).toBe('idle');
    expect(deriveAgentStatus([])).toBe('idle');
  });
});

describe('agentInitials', () => {
  it('takes up to two word-initials', () => {
    expect(agentInitials('Research Agent')).toBe('RA');
    expect(agentInitials('atlas')).toBe('A');
  });
  it('handles empty gracefully', () => {
    expect(agentInitials('   ')).toBe('?');
  });
});

describe('groupTasksByAgent', () => {
  const resolve = (k: string): Agent | undefined =>
    k === 'researcher' ? ({ id: '1', name: 'Atlas', role: 'Research' } as Agent) : undefined;

  it('groups by assigneeKey and resolves identity + derived status/progress', () => {
    const groups = groupTasksByAgent(
      [task({ assigneeKey: 'researcher', lane: 'running' }), task({ assigneeKey: 'researcher', lane: 'done' })],
      resolve,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'researcher',
      name: 'Atlas',
      role: 'Research',
      initials: 'A',
      status: 'working',
      totalCount: 2,
      doneCount: 1,
    });
  });

  it('falls back to the raw key as name when unresolved, and skips null keys', () => {
    const groups = groupTasksByAgent([task({ assigneeKey: null }), task({ assigneeKey: 'x' })], () => undefined);
    expect(groups.map((g) => g.key)).toEqual(['x']);
    expect(groups[0].name).toBe('x');
  });
});
