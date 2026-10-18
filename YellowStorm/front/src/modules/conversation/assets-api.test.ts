import { beforeEach, expect, it, vi } from 'vitest';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ apiClient: { get }, API_ENDPOINTS: { conversations: { assets: (id: string) => `/conversations/${id}/assets` } } }));
import { fetchConversationAssets } from './api';
beforeEach(() => vi.clearAllMocks());
it('skips empty source groups and retains their independent errors', async () => {
  get.mockResolvedValueOnce({ data: { data: { assets: [], nextCursor: 'workspace', sourceErrors: ['upload'] } } })
    .mockResolvedValueOnce({ data: { data: { assets: [], nextCursor: 'message' } } })
    .mockResolvedValueOnce({ data: { data: { assets: [{ ref: 'saved-app' }], nextCursor: null } } });
  expect(await fetchConversationAssets('c1')).toEqual({ assets: [{ ref: 'saved-app' }], nextCursor: null, sourceErrors: ['upload'] });
  expect(get).toHaveBeenLastCalledWith('/conversations/c1/assets', { params: { cursor: 'message' }, signal: undefined });
});
it('bounds empty-page traversal and preserves continuation for filtered histories', async () => {
  get.mockImplementation(async (_url, options) => ({ data: { data: { assets: [], nextCursor: `${options.params.cursor || ''}x` } } }));
  const page = await fetchConversationAssets('c1');
  expect(get).toHaveBeenCalledTimes(3);
  expect(page.nextCursor).toBe('xxx');
});
