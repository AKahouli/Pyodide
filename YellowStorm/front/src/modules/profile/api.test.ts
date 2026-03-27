import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  updateProfile,
  getSessions,
  revokeSession,
  updateDataSharing,
  exportData,
  deleteAccount,
  getHealthStatus,
  getHealthHistory,
  getHealthStats,
} from './api';

const getMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: getMock,
    put: putMock,
    delete: deleteMock,
    patch: patchMock,
  },
  API_ENDPOINTS: {
    users: { me: '/users/me' },
    auth: { sessions: '/auth/sessions' },
    health: {
      check: '/health/check',
      history: '/health/history',
      stats: '/health/stats',
    },
  },
}));

describe('profile api', () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    deleteMock.mockReset();
    patchMock.mockReset();
  });

  it('updates profile', async () => {
    putMock.mockResolvedValue({ data: { data: { id: 'u1' } } });

    const result = await updateProfile({ firstName: 'A' } as never);

    expect(putMock).toHaveBeenCalledWith('/users/me', { firstName: 'A' });
    expect(result).toEqual({ id: 'u1' });
  });

  it('gets sessions', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 's1' }] } });

    const sessions = await getSessions();

    expect(getMock).toHaveBeenCalledWith('/auth/sessions');
    expect(sessions).toEqual([{ id: 's1' }]);
  });

  it('revokes session', async () => {
    deleteMock.mockResolvedValue(undefined);

    await revokeSession('s1');

    expect(deleteMock).toHaveBeenCalledWith('/auth/sessions/s1');
  });

  it('updates data sharing', async () => {
    putMock.mockResolvedValue({});

    await updateDataSharing(true);

    expect(putMock).toHaveBeenCalledWith('/users/me', { dataSharing: true });
  });

  it('exports data as blob', async () => {
    const blob = new Blob(['test']);
    getMock.mockResolvedValue({ data: blob });

    const result = await exportData();

    expect(getMock).toHaveBeenCalledWith('/users/me/export', { responseType: 'blob' });
    expect(result).toBe(blob);
  });

  it('deletes account', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteAccount();

    expect(deleteMock).toHaveBeenCalledWith('/users/me');
  });

  it('gets health status with custom validateStatus', async () => {
    getMock.mockResolvedValue({ data: { data: { status: 'ok' } } });

    const result = await getHealthStatus();

    expect(getMock).toHaveBeenCalledWith('/health/check', { validateStatus: expect.any(Function) });
    expect(result).toEqual({ status: 'ok' });
  });

  it('gets health history and stats', async () => {
    getMock
      .mockResolvedValueOnce({ data: { data: { items: [] } } })
      .mockResolvedValueOnce({ data: { data: { uptime: 99 } } });

    const history = await getHealthHistory({ minutes: 30 });
    const stats = await getHealthStats(60);

    expect(getMock).toHaveBeenCalledWith('/health/history', { params: { minutes: 30 } });
    expect(history).toEqual({ items: [] });
    expect(getMock).toHaveBeenCalledWith('/health/stats', { params: { minutes: 60 } });
    expect(stats).toEqual({ uptime: 99 });
  });
});
