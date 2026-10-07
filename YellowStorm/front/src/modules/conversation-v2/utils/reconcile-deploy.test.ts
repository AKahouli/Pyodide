import { describe, expect, it, vi, afterEach } from 'vitest';
import { AxiosError } from 'axios';
import {
  isDeployConnectionLost,
  pollDeployStateFromSession,
  DEPLOY_RECONCILE_INTERVAL_MS,
} from './reconcile-deploy';
import type { SessionPointer } from '../interfaces';

function pointer(partial: Partial<SessionPointer>): SessionPointer {
  return {
    sessionId: 's1',
    title: 't',
    status: 'active',
    isShared: false,
    workspaceIds: [],
    selectedSkillIds: [],
    selectedConnectorIds: [],
    lastEventAt: '',
    eventCount: 0,
    systemWorkspaceId: null,
    deployStatus: 'idle',
    deployedUrl: null,
    lastDeployedAt: null,
    ...partial,
  };
}

describe('isDeployConnectionLost', () => {
  it('detects network and timeout axios errors', () => {
    expect(
      isDeployConnectionLost(new AxiosError('net', 'ERR_NETWORK')),
    ).toBe(true);
    expect(
      isDeployConnectionLost(new AxiosError('timeout', 'ECONNABORTED')),
    ).toBe(true);
    expect(isDeployConnectionLost(new Error('nope'))).toBe(false);
  });
});

describe('pollDeployStateFromSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns deployed state once the session pointer catches up', async () => {
    vi.useFakeTimers();
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(pointer({ deployStatus: 'deploying' }))
      .mockResolvedValueOnce(
        pointer({
          deployStatus: 'deployed',
          deployedUrl: 'https://apps.example/app/',
          lastDeployedAt: '2026-01-01T00:00:00.000Z',
        }),
      );

    const pending = pollDeployStateFromSession('s1', getSession, {
      intervalMs: DEPLOY_RECONCILE_INTERVAL_MS,
      maxWaitMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(DEPLOY_RECONCILE_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(DEPLOY_RECONCILE_INTERVAL_MS);

    await expect(pending).resolves.toEqual({
      deployStatus: 'deployed',
      deployedUrl: 'https://apps.example/app/',
      lastDeployedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
