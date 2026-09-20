import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ semanticModelApi: { dataToken: vi.fn() } }));

import { semanticModelApi } from '../api';
import { clearDataGrants, getDataGrant } from './data-access-token';

const grant = (modelId: string) => ({
  token: 't',
  realtimeToken: 'rt',
  topic: `semantic-model:${modelId}`,
  restUrl: 'http://127.0.0.1:3000',
  realtimeUrl: 'ws://127.0.0.1:4000',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

describe('data-access-token (P2.SB17)', () => {
  beforeEach(() => {
    clearDataGrants();
    vi.clearAllMocks();
  });

  it('single-flights concurrent requests for one model', async () => {
    vi.mocked(semanticModelApi.dataToken).mockResolvedValue(grant('m1'));
    const [a, b] = await Promise.all([getDataGrant('m1'), getDataGrant('m1')]);
    expect(semanticModelApi.dataToken).toHaveBeenCalledTimes(1);
    expect(a.topic).toBe('semantic-model:m1');
    expect(b.topic).toBe('semantic-model:m1');
  });

  it('reuses a fresh grant without refetching', async () => {
    vi.mocked(semanticModelApi.dataToken).mockResolvedValue(grant('m1'));
    await getDataGrant('m1');
    await getDataGrant('m1');
    expect(semanticModelApi.dataToken).toHaveBeenCalledTimes(1);
  });

  it('refetches after clear (logout / model switch)', async () => {
    vi.mocked(semanticModelApi.dataToken).mockResolvedValue(grant('m1'));
    await getDataGrant('m1');
    clearDataGrants('m1');
    await getDataGrant('m1');
    expect(semanticModelApi.dataToken).toHaveBeenCalledTimes(2);
  });

  it('drops a late resolution after clear-before-resolve', async () => {
    let resolveFetch!: (value: ReturnType<typeof grant>) => void;
    vi.mocked(semanticModelApi.dataToken).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const pending = getDataGrant('m1');
    clearDataGrants('m1');
    resolveFetch(grant('m1'));
    await expect(pending).rejects.toThrow('superseded');
    vi.mocked(semanticModelApi.dataToken).mockResolvedValue(grant('m1'));
    await getDataGrant('m1');
    expect(semanticModelApi.dataToken).toHaveBeenCalledTimes(2);
  });

  it('clears on the central auth-lost event', async () => {
    vi.mocked(semanticModelApi.dataToken).mockResolvedValue(grant('m1'));
    await getDataGrant('m1');
    window.dispatchEvent(new Event('yellostorm:auth-lost'));
    await getDataGrant('m1');
    expect(semanticModelApi.dataToken).toHaveBeenCalledTimes(2);
  });

  it('renews past the refresh horizon', async () => {
    vi.mocked(semanticModelApi.dataToken).mockResolvedValue(grant('m1'));
    await getDataGrant('m1');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    await getDataGrant('m1');
    expect(semanticModelApi.dataToken).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
