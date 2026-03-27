import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteNotification, getNotifications, getUnreadCount, markAllAsRead, markAsRead } from './api';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: getMock,
    post: postMock,
    patch: patchMock,
    delete: deleteMock,
  },
  API_ENDPOINTS: {
    notifications: {
      list: '/notifications',
      unreadCount: '/notifications/unread-count',
      markRead: '/notifications/mark-read',
      markAllRead: '/notifications/mark-all-read',
    },
    // Dummy entries to satisfy re-exports elsewhere
    models: {
      list: '/models',
      byId: (id: string) => `/models/${id}`,
      byChef: (slug: string) => `/models/chef/${slug}`,
    },
  },
}));

describe('notifications api', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
  });

  it('fetches notifications with query params', async () => {
    getMock.mockResolvedValue({ data: { data: { notifications: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } } });

    const result = await getNotifications({ page: 2, limit: 10, unreadOnly: true });

    expect(getMock).toHaveBeenCalledWith('/notifications', { params: { page: 2, limit: 10, unreadOnly: true } });
    expect(result.notifications).toEqual([]);
  });

  it('fetches unread count', async () => {
    getMock.mockResolvedValue({ data: { data: { count: 5 } } });

    const result = await getUnreadCount();

    expect(getMock).toHaveBeenCalledWith('/notifications/unread-count');
    expect(result).toEqual({ count: 5 });
  });

  it('marks notifications as read', async () => {
    patchMock.mockResolvedValue({ data: { data: { updated: 2 } } });

    const result = await markAsRead(['n1', 'n2']);

    expect(patchMock).toHaveBeenCalledWith('/notifications/mark-read', { notificationIds: ['n1', 'n2'] });
    expect(result).toEqual({ updated: 2 });
  });

  it('marks all notifications as read', async () => {
    postMock.mockResolvedValue({ data: { data: { updated: 10 } } });

    const result = await markAllAsRead();

    expect(postMock).toHaveBeenCalledWith('/notifications/mark-all-read');
    expect(result).toEqual({ updated: 10 });
  });

  it('deletes a notification', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteNotification('n-1');

    expect(deleteMock).toHaveBeenCalledWith('/notifications/n-1');
  });
});
