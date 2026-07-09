import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/api/client', () => { const post = vi.fn(); return { default: { post } }; });
import apiClient from '@/lib/api/client';
import { crawlUrl, addLinks } from './api';
const post = (apiClient as unknown as { post: ReturnType<typeof vi.fn> }).post;

describe('crawl api', () => {
  beforeEach(() => post.mockReset());
  it('crawlUrl posts the url and returns the tree envelope', async () => {
    post.mockResolvedValue({ data: { data: { tree: [], truncated: false } } });
    const res = await crawlUrl('ws1', 'https://ex.com');
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/crawl', { url: 'https://ex.com' });
    expect(res.truncated).toBe(false);
  });
  it('addLinks posts the urls and returns created docs', async () => {
    post.mockResolvedValue({ data: { data: [{ id: 'd1', type: 'url' }] } });
    const res = await addLinks('ws1', ['https://ex.com/a']);
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/links', { urls: ['https://ex.com/a'] });
    expect(res).toHaveLength(1);
  });
});
