import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAllowedUploadExtensions, __resetAllowedUploadExtensionsCache } from './useAllowedUploadExtensions';
import { getWorkspaceUploadSettings } from '../api';

vi.mock('../api', () => ({
  getWorkspaceUploadSettings: vi.fn(),
}));

const mockedFetch = vi.mocked(getWorkspaceUploadSettings);

describe('useAllowedUploadExtensions', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    __resetAllowedUploadExtensionsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the extension list on first mount and exposes the comma-joined accept string', async () => {
    mockedFetch.mockResolvedValue({ allowedExtensions: ['.pdf', '.docx'] });

    const { result } = renderHook(() => useAllowedUploadExtensions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.allowedExtensions).toEqual(['.pdf', '.docx']);
    expect(result.current.accept).toBe('.pdf,.docx');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('shares the cache across multiple consumers', async () => {
    mockedFetch.mockResolvedValue({ allowedExtensions: ['.txt'] });

    const first = renderHook(() => useAllowedUploadExtensions());
    const second = renderHook(() => useAllowedUploadExtensions());

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
      expect(second.result.current.isLoading).toBe(false);
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(first.result.current.allowedExtensions).toEqual(['.txt']);
    expect(second.result.current.allowedExtensions).toEqual(['.txt']);
  });

  it('refetches when refresh is called', async () => {
    mockedFetch
      .mockResolvedValueOnce({ allowedExtensions: ['.pdf'] })
      .mockResolvedValueOnce({ allowedExtensions: ['.pdf', '.png'] });

    const { result } = renderHook(() => useAllowedUploadExtensions());

    await waitFor(() => {
      expect(result.current.allowedExtensions).toEqual(['.pdf']);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.allowedExtensions).toEqual(['.pdf', '.png']);
    expect(result.current.accept).toBe('.pdf,.png');
  });

  it('surfaces fetch errors without clearing the cached list', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useAllowedUploadExtensions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.allowedExtensions).toEqual([]);
    expect(result.current.accept).toMatch(/\.pdf/);
  });
});
