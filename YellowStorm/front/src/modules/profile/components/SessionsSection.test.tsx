import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SessionsSection } from './SessionsSection';

const getSessionsMock = vi.hoisted(() => vi.fn());
const revokeSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  getSessions: getSessionsMock,
  revokeSession: revokeSessionMock,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('date-fns', () => ({
  formatDistanceToNow: () => 'just now',
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
}));

vi.mock('@/components/ui/separator', () => ({ Separator: () => <div>sep</div> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

describe('SessionsSection', () => {
  beforeEach(() => {
    getSessionsMock.mockReset();
    revokeSessionMock.mockReset();
  });

  it('loads sessions and revokes a session', async () => {
    getSessionsMock.mockResolvedValue([
      {
        id: 's1',
        isCurrent: false,
        // NOSONAR: 1.1.1.1 is a documentation IP address (RFC 5737), safe for test data
        ipAddress: '1.1.1.1',
        deviceInfo: { device: 'desktop', os: 'macOS', browser: 'Safari' },
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    revokeSessionMock.mockResolvedValue(undefined);

    render(<SessionsSection />);

    await waitFor(() => expect(getSessionsMock).toHaveBeenCalled());
    expect(screen.getByText('1.1.1.1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('sessions.revoke.action'));

    await waitFor(() => {
      expect(revokeSessionMock).toHaveBeenCalledWith('s1');
    });
  });
});
