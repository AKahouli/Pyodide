import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAgentMemories, getAgentMemories } from './memoryCardsApi';

const getMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  default: {
    get: getMock,
    delete: deleteMock,
  },
}));

vi.mock('@/lib/api/config', () => ({
  API_ENDPOINTS: {
    memoryCards: {
      base: '/memory-cards',
    },
  },
}));

describe('memoryCardsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists memories with only agentId when no pagination/search is given', async () => {
    getMock.mockResolvedValue({ data: { data: { memories: [{ id: 'm1' }], total: 1 } } });

    const result = await getAgentMemories('agent-1');

    expect(getMock).toHaveBeenCalledWith('/memory-cards', { params: { agentId: 'agent-1' } });
    expect(result).toEqual({ memories: [{ id: 'm1' }], total: 1 });
  });

  it('forwards page, pageSize and search as query params', async () => {
    getMock.mockResolvedValue({ data: { data: { memories: [], total: 42 } } });

    await getAgentMemories('agent-1', { page: 2, pageSize: 20, search: 'hello' });

    expect(getMock).toHaveBeenCalledWith('/memory-cards', {
      params: { agentId: 'agent-1', page: 2, pageSize: 20, search: 'hello' },
    });
  });

  it('omits an empty search term', async () => {
    getMock.mockResolvedValue({ data: { data: { memories: [], total: 0 } } });

    await getAgentMemories('agent-1', { page: 1, pageSize: 10, search: '' });

    expect(getMock).toHaveBeenCalledWith('/memory-cards', {
      params: { agentId: 'agent-1', page: 1, pageSize: 10 },
    });
  });

  it('deletes selected memories scoped by agentId', async () => {
    deleteMock.mockResolvedValue({ data: { data: { deleted: 2 } } });

    const deleted = await deleteAgentMemories('agent-1', ['m1', 'm2']);

    expect(deleteMock).toHaveBeenCalledWith('/memory-cards', {
      params: { agentId: 'agent-1' },
      data: { ids: ['m1', 'm2'] },
    });
    expect(deleted).toBe(2);
  });
});
