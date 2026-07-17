import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeployedApp } from '../types';

const listDeployedAppsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  appMarketplaceApi: { listDeployedApps: listDeployedAppsMock },
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import { AppMarketplacePage } from './AppMarketplacePage';
import { useAppMarketplaceStore, initialState } from '../store';

const mockApps: DeployedApp[] = [
  {
    sessionId: 'session-1',
    title: 'Generated app',
    deployedUrl: 'https://apps.example/app-1',
    lastDeployedAt: '2026-07-17T10:00:00.000Z',
  },
];

describe('AppMarketplacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppMarketplaceStore.setState(initialState);
  });

  it('renders the deployed apps returned by the API', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);

    render(<AppMarketplacePage />);

    expect(await screen.findByText('Generated app')).toBeInTheDocument();
    expect(screen.getByText('https://apps.example/app-1')).toBeInTheDocument();
  });

  it('opens the deployed URL in a new tab', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<AppMarketplacePage />);
    fireEvent.click(await screen.findByRole('button', { name: /card\.open/i }));

    expect(openSpy).toHaveBeenCalledWith('https://apps.example/app-1', '_blank', 'noreferrer');
    openSpy.mockRestore();
  });

  it('navigates to the associated conversation', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);

    render(<AppMarketplacePage />);
    fireEvent.click(await screen.findByRole('button', { name: /card\.conversation/i }));

    expect(navigateMock).toHaveBeenCalledWith('/conversation-v2/session-1');
  });

  it('shows the empty state when no app is deployed', async () => {
    listDeployedAppsMock.mockResolvedValueOnce([]);

    render(<AppMarketplacePage />);

    expect(await screen.findByText(/page\.empty/)).toBeInTheDocument();
  });
});
