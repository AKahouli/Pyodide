import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePlan,
  getAllPlans,
  getMaintenanceStatus,
  getUserAnalytics,
  setMaintenanceMode,
  updatePlan,
} from './api';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  default: {
    get: getMock,
    post: postMock,
    put: putMock,
    delete: deleteMock,
  },
}));

vi.mock('@/lib/api/config', () => ({
  API_ENDPOINTS: {
    analytics: {
      users: '/analytics/users',
    },
    system: {
      maintenance: '/system/maintenance',
    },
    usage: {
      plansAll: '/usage/plans/all',
      planById: (id: string) => `/usage/plans/${id}`,
    },
  },
}));

describe('admin api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds analytics query string from params', async () => {
    getMock.mockResolvedValue({ data: { data: { totalConsentingUsers: 1 } } });

    await getUserAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-01-31', groupBy: 'day' });

    expect(getMock).toHaveBeenCalledWith('/analytics/users?dateFrom=2026-01-01&dateTo=2026-01-31&groupBy=day');
  });

  it('gets and sets maintenance mode', async () => {
    getMock.mockResolvedValue({ data: { data: { enabled: false, message: '' } } });
    postMock.mockResolvedValue({ data: { data: { enabled: true, message: 'maint' } } });

    const status = await getMaintenanceStatus();
    const updated = await setMaintenanceMode({ enabled: true, message: 'maint' });

    expect(getMock).toHaveBeenCalledWith('/system/maintenance');
    expect(postMock).toHaveBeenCalledWith('/system/maintenance', { enabled: true, message: 'maint' });
    expect(status.enabled).toBe(false);
    expect(updated.enabled).toBe(true);
  });

  it('handles plans CRUD endpoints', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 'p1' }] } });
    putMock.mockResolvedValue({ data: { data: { id: 'p1', name: 'pro' } } });
    deleteMock.mockResolvedValue(undefined);

    const plans = await getAllPlans();
    const plan = await updatePlan('p1', { name: 'pro' });
    await deletePlan('p1');

    expect(getMock).toHaveBeenCalledWith('/usage/plans/all');
    expect(putMock).toHaveBeenCalledWith('/usage/plans/p1', { name: 'pro' });
    expect(deleteMock).toHaveBeenCalledWith('/usage/plans/p1');
    expect(plans).toEqual([{ id: 'p1' }]);
    expect(plan).toEqual({ id: 'p1', name: 'pro' });
  });
});
