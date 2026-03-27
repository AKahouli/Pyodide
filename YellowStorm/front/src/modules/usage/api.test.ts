import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentPlan,
  getPlans,
  getUsageHistory,
  getUsageStatus,
} from './api';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiClient: apiClientMock,
  API_ENDPOINTS: {
    usage: {
      status: '/usage/status',
      plan: '/usage/plan',
      plans: '/usage/plans',
      history: '/usage/history',
    },
  },
}));

describe('usage api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches usage status and unwraps data payload', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { data: { isLimitExceeded: false } } });
    const status = await getUsageStatus();
    expect(apiClientMock.get).toHaveBeenCalledWith('/usage/status');
    expect(status.isLimitExceeded).toBe(false);
  });

  it('fetches current plan and available plans', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { data: { slug: 'basic' } } });
    const current = await getCurrentPlan();
    expect(apiClientMock.get).toHaveBeenCalledWith('/usage/plan');
    expect(current.slug).toBe('basic');

    apiClientMock.get.mockResolvedValueOnce({ data: { data: [{ slug: 'free' }] } });
    const plans = await getPlans();
    expect(apiClientMock.get).toHaveBeenCalledWith('/usage/plans');
    expect(plans).toHaveLength(1);
  });

  it('fetches usage history with query params', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { data: { records: [], total: 0, summary: {} } } });
    await getUsageHistory({ limit: 10, skip: 20 });
    expect(apiClientMock.get).toHaveBeenCalledWith('/usage/history', {
      params: { limit: 10, skip: 20 },
    });
  });
});
