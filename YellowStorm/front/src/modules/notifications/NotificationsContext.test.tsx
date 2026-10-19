import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationsProvider, useNotifications } from './NotificationsContext';

const actor = vi.hoisted(() => ({ id: 'u1', authenticated: true }));
const pauseMock = vi.hoisted(() => vi.fn());
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
  useAuth: () => ({ isAuthenticated: actor.authenticated, user: { id: actor.id } }),
}));

vi.mock('./NotificationsService', () => ({
  notificationsService: {
    connect: connectMock,
    pause: pauseMock,
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
      {ctx.notifications.map(item => <span key={item.id}>{item.title}</span>)}
      <button onClick={() => ctx.markAsRead(['n1'])}>mark-read</button>
      <button onClick={() => ctx.markAllAsRead()}>mark-all</button>
      <button onClick={() => ctx.deleteNotification('n1')}>delete</button>
    </div>
  );
}

describe('NotificationsContext', () => {
  it('closes only notifications when hidden and catches up list and unread count on visibility', async () => {
    const view = render(<Wrapper><Consumer /></Wrapper>);
    await screen.findByText('count-1');
    expect(connectMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(getNotificationsMock).toHaveBeenCalledTimes(1);
    getUnreadCountMock.mockResolvedValue({ count: 3 });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('count-3');
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(getNotificationsMock).toHaveBeenCalledTimes(2);
    view.unmount();
    fireEvent(document, new Event('visibilitychange'));
    expect(connectMock).toHaveBeenCalledTimes(2);
  });
  it('ignores prior-owner results after an account switch', async () => {
    let finish!: (value: unknown) => void;
    getNotificationsMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<Wrapper><Consumer /></Wrapper>);
    await waitFor(() => expect(getNotificationsMock).toHaveBeenCalledTimes(1));
    actor.id = 'u2';
    getNotificationsMock.mockResolvedValue({ notifications: [{ id: 'second', title: 'Second user' }] });
    view.rerender(<Wrapper><Consumer /></Wrapper>);
    await screen.findByText('Second user');
    await act(async () => finish({ notifications: [{ id: 'private', title: 'First private user' }] }));
    expect(screen.queryByText('First private user')).toBeNull();
    actor.authenticated = false;
    view.rerender(<Wrapper><Consumer /></Wrapper>);
    expect(screen.queryByText('Second user')).toBeNull();
    fireEvent(document, new Event('visibilitychange'));
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  beforeEach(() => {
    actor.id = 'u1'; actor.authenticated = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    pauseMock.mockReset();
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
