import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: getMock,
    delete: vi.fn(),
  },
}));

import { appBuilderApi } from './api';

describe('appBuilderApi.listApps', () => {
  beforeEach(() => getMock.mockReset());

  it('falls back to empty catalog sections when the payload omits them', async () => {
    getMock.mockResolvedValue({ data: { data: { deployed: [{ sessionId: 's1' }] } } });

    await expect(appBuilderApi.listApps()).resolves.toEqual({
      deployed: [{ sessionId: 's1' }],
      shared: [],
      drafts: [],
    });
  });

  it('survives an empty response envelope', async () => {
    getMock.mockResolvedValue({ data: { data: null } });

    await expect(appBuilderApi.listApps()).resolves.toEqual({
      deployed: [],
      shared: [],
      drafts: [],
    });
  });
});
