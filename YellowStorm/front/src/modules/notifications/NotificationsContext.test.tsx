import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationsProvider, useNotifications } from './NotificationsContext';

const connectMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const getNotificationsMock = vi.hoisted(() => vi.fn());
const getUnreadCountMock = vi.hoisted(() => vi.fn());
const markAsReadMock = vi.hoisted(() => vi.fn());
const markAllAsReadMock = vi.hoisted(() => vi.fn());
const deleteNotificationMock = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'u1' } }),
}));

vi.mock('./NotificationsService', () => ({
  notificationsService: {
    connect: connectMock,
    disconnect: disconnectMock,
    subscribe: subscribeMock.mockImplementation((cb: (event: any) => void) => {
      // simulate a connected event on subscribe
      setTimeout(() => cb({ type: 'connected', data: { connectionId: 'cid' } }), 0);
      return () => {};
    }),
  },
  tNotification: (key: string) => key,
}));

vi.mock('./api', () => ({
  getNotifications: getNotificationsMock,
  getUnreadCount: getUnreadCountMock,
  markAsRead: markAsReadMock,
  markAllAsRead: markAllAsReadMock,
  deleteNotification: deleteNotificationMock,
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationsProvider>{children}</NotificationsProvider>;
}

function Consumer() {
  const ctx = useNotifications();
  return (
    <div>
      <div>count-{ctx.unreadCount}</div>
      <button onClick={() => ctx.markAsRead(['n1'])}>mark-read</button>
      <button onClick={() => ctx.markAllAsRead()}>mark-all</button>
      <button onClick={() => ctx.deleteNotification('n1')}>delete</button>
    </div>
  );
}

describe('NotificationsContext', () => {
  beforeEach(() => {
    connectMock.mockReset();
    disconnectMock.mockReset();
    subscribeMock.mockClear();
    getNotificationsMock.mockReset();
    getUnreadCountMock.mockReset();
    markAsReadMock.mockReset();
    markAllAsReadMock.mockReset();
    deleteNotificationMock.mockReset();
    getNotificationsMock.mockResolvedValue({ notifications: [{ id: 'n1', status: 'pending', title: 't', message: 'm', type: 'info', destination: 'd', metadata: { sourceModule: 'x', priority: 'normal' }, createdAt: '', updatedAt: '' }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } });
    getUnreadCountMock.mockResolvedValue({ count: 1 });
    markAsReadMock.mockResolvedValue({ updated: 1 });
    markAllAsReadMock.mockResolvedValue({ updated: 1 });
    deleteNotificationMock.mockResolvedValue(undefined);
  });

  it('fetches notifications and unread count on mount', async () => {
    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getNotificationsMock).toHaveBeenCalledWith({ limit: 50 });
      expect(getUnreadCountMock).toHaveBeenCalled();
      expect(screen.getByText('count-1')).toBeInTheDocument();
    });
  });

  it('marks notifications as read and updates unread count', async () => {
    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await waitFor(() => screen.getByText('count-1'));

    fireEvent.click(screen.getByText('mark-read'));

    await waitFor(() => {
      expect(markAsReadMock).toHaveBeenCalledWith(['n1']);
      // unread count decremented from initial 1 to 0
      expect(screen.getByText('count-0')).toBeInTheDocument();
    });
  });

  it('marks all as read and deletes notification', async () => {
    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await waitFor(() => screen.getByText('count-1'));

    fireEvent.click(screen.getByText('mark-all'));
    await waitFor(() => {
      expect(markAllAsReadMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('delete'));
    await waitFor(() => {
      expect(deleteNotificationMock).toHaveBeenCalledWith('n1');
    });
  });
});
