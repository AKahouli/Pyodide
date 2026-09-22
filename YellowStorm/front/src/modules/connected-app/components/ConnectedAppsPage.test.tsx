import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import type { ConnectedAppWithStatus } from '../types';

const mockFetchApps = vi.hoisted(() => vi.fn());
const mockAppsRef = vi.hoisted(() => ({ current: [] as ConnectedAppWithStatus[] }));
const mockLoadingRef = vi.hoisted(() => ({ current: false }));

vi.mock('../store', () => ({
  useConnectedAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ fetchApps: mockFetchApps }),
  useConnectedApps: () => mockAppsRef.current,
  useConnectedAppsLoading: () => mockLoadingRef.current,
}));

vi.mock('./AppCard', () => ({
  AppCard: ({ app }: { app: ConnectedAppWithStatus }) => (
    <div data-testid={`app-card-${app.appKey}`}>{app.displayName}</div>
  ),
}));

vi.mock('@/modules/admin/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    canUseFeature: () => true,
    canSeeMenu: () => true,
  }),
}));

import { ConnectedAppsPage } from './ConnectedAppsPage';

const sampleApps: ConnectedAppWithStatus[] = [
  {
    appKey: 'google-drive',
    displayName: 'Google Drive',
    scopes: ['drive.readonly'],
    sortOrder: 1,
    connected: true,
  },
  {
    appKey: 'github',
    displayName: 'GitHub',
    scopes: ['repo'],
    sortOrder: 2,
    connected: false,
  },
];

describe('ConnectedAppsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppsRef.current = [];
    mockLoadingRef.current = false;
  });

  it('should show loading spinner when loading with no apps', () => {
    mockLoadingRef.current = true;
    mockAppsRef.current = [];

    render(<MemoryRouter><ConnectedAppsPage /></MemoryRouter>);

    expect(screen.getByText('page.title')).toBeInTheDocument();
    // The spinner is an animated div, check for its presence
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('should show empty state when not loading and no apps', () => {
    mockLoadingRef.current = false;
    mockAppsRef.current = [];

    render(<MemoryRouter><ConnectedAppsPage /></MemoryRouter>);

    expect(screen.getByText('page.empty')).toBeInTheDocument();
  });

  it('should render AppCard for each app', () => {
    mockAppsRef.current = sampleApps;

    render(<MemoryRouter><ConnectedAppsPage /></MemoryRouter>);

    expect(screen.getByTestId('app-card-google-drive')).toBeInTheDocument();
    expect(screen.getByTestId('app-card-github')).toBeInTheDocument();
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('should call fetchApps on mount', () => {
    render(<MemoryRouter><ConnectedAppsPage /></MemoryRouter>);

    expect(mockFetchApps).toHaveBeenCalledTimes(1);
  });
});
