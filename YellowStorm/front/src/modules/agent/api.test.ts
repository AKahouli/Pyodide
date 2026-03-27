import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent, deleteAgent, getActiveTools, getAgentTypes, getAllAgents, updateAgent } from './api';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  default: {
    get: getMock,
    post: postMock,
    patch: patchMock,
    delete: deleteMock,
  },
}));

vi.mock('@/lib/api/config', () => ({
  API_ENDPOINTS: {
    agents: {
      all: '/agents/all',
      list: '/agents',
      byId: (id: string) => `/agents/${id}`,
    },
    agentTypes: {
      active: '/agent-types/active',
    },
    tools: {
      active: '/tools/active',
    },
  },
}));

describe('agent api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets all agents from /agents/all', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 'a1' }] } });

    const result = await getAllAgents();

    expect(getMock).toHaveBeenCalledWith('/agents/all');
    expect(result).toEqual([{ id: 'a1' }]);
  });

  it('gets active agent types', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 't1' }] } });

    const result = await getAgentTypes();

    expect(getMock).toHaveBeenCalledWith('/agent-types/active');
    expect(result).toEqual([{ id: 't1' }]);
  });

  it('creates agent via POST /agents', async () => {
    postMock.mockResolvedValue({ data: { data: { id: 'new' } } });

    const result = await createAgent({ name: 'Agent', agentType: 'type', role: 'role' } as never);

    expect(postMock).toHaveBeenCalledWith('/agents', { name: 'Agent', agentType: 'type', role: 'role' });
    expect(result).toEqual({ id: 'new' });
  });

  it('updates agent via PATCH /agents/:id', async () => {
    patchMock.mockResolvedValue({ data: { data: { id: 'a1', name: 'Updated' } } });

    const result = await updateAgent('a1', { name: 'Updated' });

    expect(patchMock).toHaveBeenCalledWith('/agents/a1', { name: 'Updated' });
    expect(result).toEqual({ id: 'a1', name: 'Updated' });
  });

  it('deletes agent via DELETE /agents/:id', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteAgent('a1');

    expect(deleteMock).toHaveBeenCalledWith('/agents/a1');
  });

  it('gets active tools list', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 'tool-1' }] } });

    const result = await getActiveTools();

    expect(getMock).toHaveBeenCalledWith('/tools/active');
    expect(result).toEqual([{ id: 'tool-1' }]);
  });
});
