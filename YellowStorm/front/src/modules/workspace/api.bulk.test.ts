import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => {
  const post = vi.fn();
  return { default: { post }, __post: post };
});

import apiClient from '@/lib/api/client';
import { completeBulkUpload, uploadToAzure } from './api';

const post = (apiClient as unknown as { post: ReturnType<typeof vi.fn> }).post;

describe('workspace bulk api', () => {
  beforeEach(() => post.mockReset());

  it('completeBulkUpload sends autoIndex=true when enabled', async () => {
    post.mockResolvedValue({
      data: {
        data: {
          sessionId: 's1',
          status: 'success',
          totalFiles: 1,
          successful: { count: 1, documents: [] },
          failed: { count: 0, files: [] },
          duration: 10,
        },
      },
    });

    await completeBulkUpload('ws1', 's1', false, true);

    expect(post).toHaveBeenCalledWith(
      '/workspaces/ws1/documents/bulk/s1/complete',
      undefined,
      { params: { autoIndex: 'true' } },
    );
  });

  it('completeBulkUpload sends autoIndex=false when disabled', async () => {
    post.mockResolvedValue({
      data: {
        data: {
          sessionId: 's1',
          status: 'success',
          totalFiles: 1,
          successful: { count: 1, documents: [] },
          failed: { count: 0, files: [] },
          duration: 10,
        },
      },
    });

    await completeBulkUpload('ws1', 's1', true, false);

    expect(post).toHaveBeenCalledWith(
      '/workspaces/ws1/documents/bulk/s1/complete',
      undefined,
      { params: { deepSearch: 'true', autoIndex: 'false' } },
    );
  });

  it('completeBulkUpload omits params when flags are undefined', async () => {
    post.mockResolvedValue({
      data: {
        data: {
          sessionId: 's1',
          status: 'success',
          totalFiles: 0,
          successful: { count: 0, documents: [] },
          failed: { count: 0, files: [] },
          duration: 1,
        },
      },
    });

    await completeBulkUpload('ws1', 's1');

    expect(post).toHaveBeenCalledWith(
      '/workspaces/ws1/documents/bulk/s1/complete',
      undefined,
      { params: undefined },
    );
  });
});


describe('presigned upload headers', () => {
  it.each([
    ['https://storage.example/file?X-Amz-SignedHeaders=host%3Bif-none-match', true],
    ['https://storage.example/file?X-Amz-SignedHeaders=host', false],
    ['https://acct.blob.core.windows.net/file?sp=c&sig=synthetic', false],
  ])('sends only the required signature precondition for %s', async (url, expected) => {
    const headers = vi.fn();
    const events = new Map<string, () => void>();
    const fake = { status: 201, upload: { addEventListener: vi.fn() }, open: vi.fn(),
      setRequestHeader: headers, abort: vi.fn(),
      addEventListener: (event: string, callback: () => void) => events.set(event, callback),
      send: () => events.get('load')?.() };
    vi.stubGlobal('XMLHttpRequest', vi.fn(function () { return fake; }));
    try {
      await uploadToAzure(url, new File(['image'], 'image.png', { type: 'image/png' }));
      if (expected) expect(headers).toHaveBeenCalledWith('If-None-Match', '*');
      else expect(headers).not.toHaveBeenCalledWith('If-None-Match', '*');
      expect(headers).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(headers).toHaveBeenCalledWith('x-ms-blob-type', 'BlockBlob');
    } finally { vi.unstubAllGlobals(); }
  });
});
