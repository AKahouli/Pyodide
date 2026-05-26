import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVncSession } from './useVncSession';
import { conversationV2Api } from '../api';

vi.mock('../api', () => ({
  conversationV2Api: { getVncSignedUrl: vi.fn() },
}));

describe('useVncSession', () => {
  beforeEach(() => vi.resetAllMocks());

  it('fetches URL on mount and reports connecting state', async () => {
    (conversationV2Api.getVncSignedUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'wss://x',
      expiresAt: Date.now() + 60_000,
    });
    const { result } = renderHook(() => useVncSession('s1', { autoStart: true }));
    await waitFor(() => expect(result.current.status).toBe('connecting'));
    expect(result.current.url).toBe('wss://x');
  });

  it('surfaces VM_UNAVAILABLE as unavailable status', async () => {
    (conversationV2Api.getVncSignedUrl as unknown as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { error: { code: 'VM_UNAVAILABLE' } } },
    });
    const { result } = renderHook(() => useVncSession('s1', { autoStart: true }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  it('reports error status on unknown failure', async () => {
    (conversationV2Api.getVncSignedUrl as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down'),
    );
    const { result } = renderHook(() => useVncSession('s1', { autoStart: true }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain('network down');
  });
});
