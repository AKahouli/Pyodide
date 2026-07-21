import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamPlaybookIntentConstruction } from './api';

describe('streamPlaybookIntentConstruction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('propagates event callback failures without retrying the stream', async () => {
    const payload = [
      'event: failed',
      'data: {"type":"failed","constructionId":"c1","playbookId":"p1","sequence":1,"createdAt":"2026-07-18T00:00:00.000Z","message":"Generation failed","recoverable":true}',
      '',
      '',
    ].join('\n');
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ value: new TextEncoder().encode(payload), done: false })
        .mockResolvedValueOnce({ value: undefined, done: true }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamPlaybookIntentConstruction('p1', 'c1', {
      onEvent: () => {
        throw new Error('Terminal construction failure');
      },
    })).rejects.toThrow('Terminal construction failure');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
