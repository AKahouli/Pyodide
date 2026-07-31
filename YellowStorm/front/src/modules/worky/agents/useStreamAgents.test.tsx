import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../store', () => ({ useWorkyBoard: vi.fn() }));
vi.mock('../../agent/store', () => ({ useAgentStore: vi.fn() }));

import { useWorkyBoard } from '../store';
import { useAgentStore } from '../../agent/store';
import { useStreamAgents } from './useStreamAgents';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: unknown) => fn as any;
const emptyLanes = { backlog: [], ready: [], running: [], review: [], blocked: [], done: [] };

beforeEach(() => vi.clearAllMocks());

describe('useStreamAgents', () => {
  it('groups the current board tasks by agent and resolves identity', () => {
    asMock(useWorkyBoard).mockReturnValue({
      ...emptyLanes,
      running: [{ id: '1', title: 'A', lane: 'running', assigneeKey: 'researcher' }],
      done: [{ id: '2', title: 'B', lane: 'done', assigneeKey: 'researcher' }],
    });
    asMock(useAgentStore).mockImplementation((sel: (s: unknown) => unknown) =>
      sel({ agents: [{ id: '1', name: 'Atlas', slug: 'researcher', role: 'Research' }] }),
    );

    const { result } = renderHook(() => useStreamAgents());
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0]).toMatchObject({ name: 'Atlas', status: 'working', totalCount: 2 });
    expect(result.current.ungrouped).toHaveLength(0);
  });

  it('returns empty when the board is null', () => {
    asMock(useWorkyBoard).mockReturnValue(null);
    asMock(useAgentStore).mockImplementation((sel: (s: unknown) => unknown) => sel({ agents: [] }));
    const { result } = renderHook(() => useStreamAgents());
    expect(result.current.agents).toEqual([]);
    expect(result.current.ungrouped).toEqual([]);
  });

  it('surfaces tasks without an assigneeKey as ungrouped', () => {
    asMock(useWorkyBoard).mockReturnValue({
      ...emptyLanes,
      backlog: [{ id: '3', title: 'C', lane: 'backlog', assigneeKey: null }],
    });
    asMock(useAgentStore).mockImplementation((sel: (s: unknown) => unknown) => sel({ agents: [] }));
    const { result } = renderHook(() => useStreamAgents());
    expect(result.current.agents).toEqual([]);
    expect(result.current.ungrouped).toHaveLength(1);
  });
});
