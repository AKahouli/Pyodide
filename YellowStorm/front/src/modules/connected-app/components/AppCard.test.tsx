import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ConnectedAppWithStatus } from '../types';

const mockConnectApp = vi.hoisted(() => vi.fn());
const mockDisconnectApp = vi.hoisted(() => vi.fn());
const mockConnectingAppKey = vi.hoisted(() => ({ current: null as string | null }));

vi.mock('../store', () => ({
  useConnectedAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      connectApp: mockConnectApp,
      disconnectApp: mockDisconnectApp,
      connectingAppKey: mockConnectingAppKey.current,
    }),
}));

vi.mock('./AppIcon', () => ({
  AppIcon: ({ iconKey }: { iconKey: string }) => (
    <span data-testid={`app-icon-${iconKey}`} />
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="card" {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="card-content" {...props}>{children}</div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: React.PropsWithChildren<{
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }>) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <span data-testid="badge" {...props}>{children}</span>
  ),
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({
    children,
    open,
  }: React.PropsWithChildren<{ open?: boolean }>) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: React.PropsWithChildren) => (
    <div data-testid="alert-dialog-content">{children}</div>
  ),
  AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: React.PropsWithChildren) => (
    <div data-testid="alert-dialog-title">{children}</div>
  ),
  AlertDialogDescription: ({ children }: React.PropsWithChildren) => (
    <div data-testid="alert-dialog-description">{children}</div>
  ),
  AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogCancel: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button data-testid="alert-cancel" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button data-testid="alert-action" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { AppCard } from './AppCard';

const connectedApp: ConnectedAppWithStatus = {
  appKey: 'google-drive',
  displayName: 'Google Drive',
  description: 'Access your Google Drive files',
  scopes: ['drive.readonly'],
  sortOrder: 1,
  connected: true,
  connection: {
    appKey: 'google-drive',
    displayName: 'Google Drive',
    status: 'active',
    scopes: ['drive.readonly'],
    providerEmail: 'user@gmail.com',
    connectedAt: '2026-01-01T00:00:00Z',
  },
};

const disconnectedApp: ConnectedAppWithStatus = {
  appKey: 'github',
  displayName: 'GitHub',
  description: 'Connect to GitHub repositories',
  scopes: ['repo'],
  sortOrder: 2,
  connected: false,
};

describe('AppCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectingAppKey.current = null;
  });

  it('should show connect button when not connected', () => {
    render(<AppCard app={disconnectedApp} />);

    expect(screen.getByText('card.connect')).toBeInTheDocument();
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
  });

  it('should show disconnect button and connected badge when connected', () => {
    render(<AppCard app={connectedApp} />);

    expect(screen.getByText('card.disconnect')).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByText('card.connected')).toBeInTheDocument();
  });

  it('should show provider email when connected', () => {
    render(<AppCard app={connectedApp} />);

    expect(
      screen.getByText('card.connectedAs'),
    ).toBeInTheDocument();
  });

  it('should show the app description', () => {
    render(<AppCard app={disconnectedApp} />);

    expect(screen.getByText('Connect to GitHub repositories')).toBeInTheDocument();
  });

  it('should call connectApp when clicking connect button', () => {
    render(<AppCard app={disconnectedApp} />);

    fireEvent.click(screen.getByText('card.connect'));

    expect(mockConnectApp).toHaveBeenCalledWith('github');
  });

  it('should show loading state when connecting', () => {
    mockConnectingAppKey.current = 'github';

    render(<AppCard app={disconnectedApp} />);

    const connectButton = screen.getByText('card.connect').closest('button');
    expect(connectButton).toBeDisabled();
  });

  it('should show disconnect confirmation dialog when clicking disconnect', () => {
    render(<AppCard app={connectedApp} />);

    // Initially, dialog should not be open
    expect(screen.queryByTestId('alert-dialog')).not.toBeInTheDocument();

    // Click disconnect
    fireEvent.click(screen.getByText('card.disconnect'));

    // Dialog should now be open
    expect(screen.getByTestId('alert-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('alert-dialog-title')).toBeInTheDocument();
  });

  it('should call disconnectApp when confirming disconnect', () => {
    render(<AppCard app={connectedApp} />);

    // Open the dialog
    fireEvent.click(screen.getByText('card.disconnect'));

    // Click confirm action
    fireEvent.click(screen.getByTestId('alert-action'));

    expect(mockDisconnectApp).toHaveBeenCalledWith('google-drive');
  });

  it('should render AppIcon with correct iconKey', () => {
    render(<AppCard app={connectedApp} />);

    expect(screen.getByTestId('app-icon-google-drive')).toBeInTheDocument();
  });
});
