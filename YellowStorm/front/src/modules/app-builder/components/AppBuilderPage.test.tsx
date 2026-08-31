import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeployedApp } from '../types';

const listDeployedAppsMock = vi.hoisted(() => vi.fn());
const removeAppMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  appBuilderApi: {
    listDeployedApps: listDeployedAppsMock,
    removeApp: removeAppMock,
  },
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import { AppBuilderPage } from './AppBuilderPage';
import { useAppBuilderStore, initialState } from '../store';

const mockApps: DeployedApp[] = [
  {
    sessionId: 'session-1',
    title: 'Generated app',
    deployedUrl: 'https://apps.example/app-1',
    lastDeployedAt: '2026-07-17T10:00:00.000Z',
    source: 'owned',
    shareId: null,
  },
];

const sharedApps: DeployedApp[] = [
  {
    sessionId: 'session-2',
    title: 'Shared app',
    deployedUrl: 'https://apps.example/app-2',
    lastDeployedAt: '2026-07-16T10:00:00.000Z',
    source: 'shared',
    shareId: 'share-2',
  },
];

const mixedApps: DeployedApp[] = [...mockApps, ...sharedApps];

function renderPage(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AppBuilderPage />
    </MemoryRouter>,
  );
}

describe('AppBuilderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppBuilderStore.setState(initialState);
  });

  it('renders the deployed apps returned by the API', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);

    renderPage();

    expect(await screen.findByText('Generated app')).toBeInTheDocument();
    expect(screen.getByText('https://apps.example/app-1')).toBeInTheDocument();
  });

  it('opens the deployed URL in a new tab', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /card\.open/i }));

    expect(openSpy).toHaveBeenCalledWith('https://apps.example/app-1', '_blank', 'noreferrer');
    openSpy.mockRestore();
  });

  it('navigates to the associated conversation', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /card\.conversation/i }));

    expect(navigateMock).toHaveBeenCalledWith('/conversation-v2/session-1');
  });

  it('removes a card after delete confirmation', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);
    removeAppMock.mockResolvedValueOnce(undefined);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /card\.delete/i }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /card\.delete/i }));

    await waitFor(() => expect(screen.queryByText('Generated app')).not.toBeInTheDocument());
    expect(removeAppMock).toHaveBeenCalledWith('session-1');
  });

  it('hides conversation and share actions for shared apps without conversation access', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(sharedApps);

    renderPage();

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.getByText(/card\.shared/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /card\.conversation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /card\.share/i })).not.toBeInTheDocument();
  });

  it('shows conversation for shared apps with conversation access', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(
      sharedApps.map((app) => ({ ...app, canOpenConversation: true })),
    );

    renderPage();

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /card\.conversation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /card\.share/i })).toBeInTheDocument();
  });

  it('opens the share dialog from the card', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /card\.share/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows the empty state when no app is deployed', async () => {
    listDeployedAppsMock.mockResolvedValueOnce([]);

    renderPage();

    expect(await screen.findByText(/page\.empty/)).toBeInTheDocument();
  });

  it('filters apps by search query from URL', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mixedApps);

    renderPage('/?q=Shared');

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
  });

  it('filters apps to shared only from URL owner param', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mixedApps);

    renderPage('/?owner=shared');

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
  });

  it('shows shared app titles in grid view', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mixedApps);

    renderPage('/?view=grid');

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.getByText('Generated app')).toBeInTheDocument();
  });
});
