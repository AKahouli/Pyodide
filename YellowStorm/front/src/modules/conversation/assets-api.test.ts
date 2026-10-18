import { beforeEach, expect, it, vi } from 'vitest';
const { get, remove } = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiClient: { get, delete: remove }, API_ENDPOINTS: { conversations: { assets: (id: string) => `/conversations/${id}/assets`, asset: (id: string, ref: string) => `/conversations/${id}/assets/${encodeURIComponent(ref)}` } } }));
import { fetchConversationAssets, deleteConversationAsset } from './api';
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

it('deletes only the selected scoped asset and preserves cleanup outcome', async () => {
  const result = { deleted: true, alreadyDeleted: false, cleanup: { blob: 'pending', index: 'done' } };
  remove.mockResolvedValue({ data: { data: result } });
  expect(await deleteConversationAsset('c1', 'exact-ref')).toEqual(result);
  expect(remove).toHaveBeenCalledWith('/conversations/c1/assets/exact-ref');
});

it('preserves pending cleanup when skipping empty active-source pages', async () => {
  get.mockResolvedValueOnce({ data: { data: { assets: [], nextCursor: 'next', pendingCleanup: [{ ref: 'deleted-ref', status: 'deleted' }] } } })
    .mockResolvedValueOnce({ data: { data: { assets: [{ ref: 'active-ref' }], nextCursor: null } } });
  expect(await fetchConversationAssets('c1')).toMatchObject({ assets: [{ ref: 'active-ref' }], pendingCleanup: [{ ref: 'deleted-ref' }] });
});
