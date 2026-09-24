import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStreams, searchUsers } from './api';
import apiClient from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ default: { get: vi.fn() } }));

describe('getStreams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unwraps the paginated envelope (data + meta) and forwards query params', async () => {
    const envelope = {
      data: [{ id: '1', title: 'A', stats: { totalTasks: 3, done: 1, progress: 0.33 } }],
      meta: { total: 25, page: 2, limit: 12, totalPages: 3, statusCounts: { active: 5 } },
    };
    (apiClient.get as any).mockResolvedValue({ data: { data: envelope } });

    const result = await getStreams({ page: 2, limit: 12, search: 'a', status: ['active'] });

    expect(apiClient.get).toHaveBeenCalledWith('/worky/streams', {
      params: { page: 2, limit: 12, search: 'a', status: ['active'] },
    });
    expect(result.meta.total).toBe(25);
    expect(result.data).toHaveLength(1);
  });
});

describe('searchUsers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries the shared user directory and unwraps results', async () => {
    const users = [{ id: 'u1', email: 'member@example.com' }];
    (apiClient.get as any).mockResolvedValue({ data: { data: users } });

    await expect(searchUsers('member', 8)).resolves.toEqual(users);
    expect(apiClient.get).toHaveBeenCalledWith('/users/search', {
      params: { q: 'member', limit: 8 },
    });
  });
});
