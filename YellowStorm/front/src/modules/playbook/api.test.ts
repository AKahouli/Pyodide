import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS } from '@/lib/api/config';
import {
  bulkDeletePlaybooks,
  clonePlaybook,
  cloneSharePlaybook,
  createPlaybook,
  deleteAllExecutions,
  executePlaybook,
  getExecution,
  getPlaybook,
  getPlaybooks,
  toggleFavorite,
  updatePlaybook,
  getPlaybookSchedule,
  upsertPlaybookSchedule,
  clearPlaybookSchedule,
} from './api';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: apiClientMock,
}));

describe('playbook api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets paginated playbooks with query params', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { data: { playbooks: [{ id: 'p1' }], pagination: { page: 1 } } } });
    const result = await getPlaybooks({ page: 2, limit: 10, search: 'ops' });
    expect(apiClientMock.get).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.list, {
      params: { page: 2, limit: 10, search: 'ops' },
    });
    expect(result.playbooks[0].id).toBe('p1');
  });

  it('creates, updates, and fetches a playbook by id', async () => {
    const payload = { name: 'Automation', description: 'desc' };
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { id: 'p1' } } });
    await createPlaybook(payload);
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.list, payload);

    apiClientMock.patch.mockResolvedValueOnce({ data: { data: { id: 'p1', name: 'Updated' } } });
    await updatePlaybook('p1', { name: 'Updated' });
    expect(apiClientMock.patch).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.byId('p1'), { name: 'Updated' });

    apiClientMock.get.mockResolvedValueOnce({ data: { data: { id: 'p1', name: 'Updated' } } });
    const playbook = await getPlaybook('p1');
    expect(apiClientMock.get).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.byId('p1'));
    expect(playbook.id).toBe('p1');
  });

  it('executes and gets execution details', async () => {
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { executionId: 'e1' } } });
    const started = await executePlaybook('p1', { query: 'test run' });
    expect(started.executionId).toBe('e1');
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.execute('p1'), { query: 'test run' });

    apiClientMock.get.mockResolvedValueOnce({ data: { data: { id: 'e1' } } });
    await getExecution('p1', 'e1');
    expect(apiClientMock.get).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.execution('p1', 'e1'));
  });

  it('gets, upserts, and clears playbook schedule', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { data: { enabled: true, timezone: 'UTC', type: 'daily' } } });
    await getPlaybookSchedule('p1');
    expect(apiClientMock.get).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.schedule('p1'));

    apiClientMock.put.mockResolvedValueOnce({ data: { data: { id: 'p1', executionSchedule: null } } });
    await upsertPlaybookSchedule('p1', {
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['09:00'] },
    });
    expect(apiClientMock.put).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.schedule('p1'), {
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['09:00'] },
    });

    apiClientMock.delete.mockResolvedValueOnce({ data: { data: { id: 'p1', executionSchedule: null } } });
    await clearPlaybookSchedule('p1');
    expect(apiClientMock.delete).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.schedule('p1'));
  });

  it('toggles favorite, bulk deletes, clones, and clone-shares', async () => {
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { isFavorite: true } } });
    await toggleFavorite('p1');
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.favorite('p1'));

    apiClientMock.post.mockResolvedValueOnce({ data: { data: { deleted: 2 } } });
    await bulkDeletePlaybooks(['p1', 'p2']);
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.bulkDelete, { ids: ['p1', 'p2'] });

    apiClientMock.post.mockResolvedValueOnce({ data: { data: { id: 'p2' } } });
    await clonePlaybook('p1');
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.clone('p1'));

    apiClientMock.post.mockResolvedValueOnce({ data: { data: { succeeded: [], failed: [] } } });
    await cloneSharePlaybook('p1', ['a@x.com']);
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.cloneShare('p1'), { emails: ['a@x.com'] });
  });

  it('deletes all executions for a playbook', async () => {
    apiClientMock.delete.mockResolvedValueOnce({ data: { data: { deleted: 3, kept: 1 } } });
    const result = await deleteAllExecutions('p1');
    expect(apiClientMock.delete).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.deleteAllExecutions('p1'));
    expect(result).toEqual({ deleted: 3, kept: 1 });
  });
});
