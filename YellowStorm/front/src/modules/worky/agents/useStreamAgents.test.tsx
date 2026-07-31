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

const agentState = (agents: unknown[]) => ({ agents, fetchAgents: vi.fn(), isInitialized: true });
const mockAgents = (agents: unknown[]) =>
  asMock(useAgentStore).mockImplementation((sel: (s: unknown) => unknown) => sel(agentState(agents)));

beforeEach(() => vi.clearAllMocks());

describe('useStreamAgents', () => {
  it('resolves the agent name by its Mongo id (assigneeKey)', () => {
    asMock(useWorkyBoard).mockReturnValue({
      ...emptyLanes,
      running: [{ id: '1', title: 'A', lane: 'running', assigneeKey: '64f0agent01' }],
      done: [{ id: '2', title: 'B', lane: 'done', assigneeKey: '64f0agent01' }],
    });
    mockAgents([{ id: '64f0agent01', name: 'Atlas', slug: 'researcher', role: 'Research' }]);

    const { result } = renderHook(() => useStreamAgents());
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0]).toMatchObject({ name: 'Atlas', status: 'working', totalCount: 2 });
    expect(result.current.ungrouped).toHaveLength(0);
  });

  it('falls back to slug/name resolution when the key is not an id', () => {
    asMock(useWorkyBoard).mockReturnValue({
      ...emptyLanes,
      running: [{ id: '1', title: 'A', lane: 'running', assigneeKey: 'researcher' }],
    });
    mockAgents([{ id: '64f0agent01', name: 'Atlas', slug: 'researcher', role: 'Research' }]);
    const { result } = renderHook(() => useStreamAgents());
    expect(result.current.agents[0]).toMatchObject({ name: 'Atlas' });
  });

  it('returns empty when the board is null', () => {
    asMock(useWorkyBoard).mockReturnValue(null);
    mockAgents([]);
    const { result } = renderHook(() => useStreamAgents());
    expect(result.current.agents).toEqual([]);
    expect(result.current.ungrouped).toEqual([]);
  });

  it('surfaces tasks without an assigneeKey as ungrouped', () => {
    asMock(useWorkyBoard).mockReturnValue({
      ...emptyLanes,
      backlog: [{ id: '3', title: 'C', lane: 'backlog', assigneeKey: null }],
    });
    mockAgents([]);
    const { result } = renderHook(() => useStreamAgents());
    expect(result.current.agents).toEqual([]);
    expect(result.current.ungrouped).toHaveLength(1);
  });
});
