import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => {
  const post = vi.fn();
  return { default: { post }, __post: post };
});

import apiClient from '@/lib/api/client';
import { validateUrl, addLink } from './api';

const post = (apiClient as unknown as { post: ReturnType<typeof vi.fn> }).post;

describe('workspace link api', () => {
  beforeEach(() => post.mockReset());

  it('validateUrl posts the url and returns the envelope data', async () => {
    post.mockResolvedValue({ data: { data: { reachable: true, status: 200 } } });
    const res = await validateUrl('ws1', 'https://example.com');
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/validate-url', { url: 'https://example.com' });
    expect(res.reachable).toBe(true);
  });

  it('addLink posts the url and returns the created document', async () => {
    post.mockResolvedValue({ data: { data: { id: 'd1', type: 'url', status: 'processing' } } });
    const res = await addLink('ws1', 'https://example.com');
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/link', { url: 'https://example.com' });
    expect(res.type).toBe('url');
  });
});
