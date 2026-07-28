import { describe, it, expect, vi, beforeEach } from 'vitest';

const { post } = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({ default: { post }, ApiResponse: undefined }));

import { crawlUrl } from './api';

beforeEach(() => post.mockReset());

describe('crawlUrl', () => {
  it('posts the url and returns the discovered pages', async () => {
    post.mockResolvedValue({ data: { data: { pages: [{ url: 'https://a.com/docs/x' }], truncated: false } } });
    const res = await crawlUrl('w1', 'https://a.com/docs');
    expect(post).toHaveBeenCalledWith('/workspaces/w1/documents/crawl', { url: 'https://a.com/docs' });
    expect(res.pages[0].url).toBe('https://a.com/docs/x');
  });
});
