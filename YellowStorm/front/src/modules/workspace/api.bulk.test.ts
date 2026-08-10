import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => {
  const post = vi.fn();
  return { default: { post }, __post: post };
});

import apiClient from '@/lib/api/client';
import { completeBulkUpload } from './api';

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
