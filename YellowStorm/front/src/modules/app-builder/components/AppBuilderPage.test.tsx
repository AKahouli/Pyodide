import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeployedApp, DraftApp } from '../types';

const listAppsMock = vi.hoisted(() => vi.fn());
const removeAppMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  appBuilderApi: {
    listApps: listAppsMock,
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

const mockDeployed: DeployedApp[] = [
  {
    sessionId: 'session-1',
    title: 'Generated app',
    deployedUrl: 'https://apps.example/app-1',
    lastDeployedAt: '2026-07-17T10:00:00.000Z',
    source: 'owned',
    shareId: null,
  },
];

const mockShared: DeployedApp[] = [
  {
    sessionId: 'session-2',
    title: 'Shared app',
    deployedUrl: 'https://apps.example/app-2',
    lastDeployedAt: '2026-07-16T10:00:00.000Z',
    source: 'shared',
    shareId: 'share-2',
  },
];

const mockDrafts: DraftApp[] = [
  {
    sessionId: 'session-3',
    title: 'Draft app',
    lastUpdatedAt: '2026-07-15T10:00:00.000Z',
    deployStatus: 'idle',
  },
];

const fullCatalog = {
  deployed: mockDeployed,
  shared: mockShared,
  drafts: mockDrafts,
};

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

  it('renders deployed apps by default', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage();

    expect(await screen.findByText('Generated app')).toBeInTheDocument();
    expect(screen.queryByText('Shared app')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft app')).not.toBeInTheDocument();
  });

  it('switches to shared apps via status ticket', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage();
    await screen.findByText('Generated app');

    fireEvent.click(screen.getByRole('tab', { name: /hub\.tickets\.shared\.label/i }));

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
  });

  it('switches to draft apps via status ticket', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage();
    await screen.findByText('Generated app');

    fireEvent.click(screen.getByRole('tab', { name: /hub\.tickets\.draft\.label/i }));

    expect(await screen.findByText('Draft app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
  });

  it('opens the deployed URL in a new tab', async () => {
    listAppsMock.mockResolvedValueOnce({ deployed: mockDeployed, shared: [], drafts: [] });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /card\.open/i }));

    expect(openSpy).toHaveBeenCalledWith('https://apps.example/app-1', '_blank', 'noreferrer');
    openSpy.mockRestore();
  });

  it('navigates to the associated conversation', async () => {
    listAppsMock.mockResolvedValueOnce({ deployed: mockDeployed, shared: [], drafts: [] });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /card\.conversation/i }));

    expect(navigateMock).toHaveBeenCalledWith('/conversation-v2/session-1');
  });

  it('removes a card after delete confirmation', async () => {
    listAppsMock.mockResolvedValueOnce({ deployed: mockDeployed, shared: [], drafts: [] });
    removeAppMock.mockResolvedValueOnce(undefined);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /card\.delete/i }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /card\.delete/i }));

    await waitFor(() => expect(screen.queryByText('Generated app')).not.toBeInTheDocument());
    expect(removeAppMock).toHaveBeenCalledWith('session-1');
  });

  it('hides conversation and share actions for shared apps without conversation access', async () => {
    listAppsMock.mockResolvedValueOnce({ deployed: [], shared: mockShared, drafts: [] });

    renderPage('/?tab=shared');

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.getByText(/card\.shared/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /card\.conversation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /card\.share/i })).not.toBeInTheDocument();
  });

  it('shows conversation for shared apps with conversation access', async () => {
    listAppsMock.mockResolvedValueOnce({
      deployed: [],
      shared: mockShared.map((app) => ({ ...app, canOpenConversation: true })),
      drafts: [],
    });

    renderPage('/?tab=shared');

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /card\.conversation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /card\.share/i })).toBeInTheDocument();
  });

  it('opens the share dialog from the card', async () => {
    listAppsMock.mockResolvedValueOnce({ deployed: mockDeployed, shared: [], drafts: [] });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /card\.share/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows the empty state when no app exists', async () => {
    listAppsMock.mockResolvedValueOnce({ deployed: [], shared: [], drafts: [] });

    renderPage();

    expect(await screen.findByText(/page\.empty/)).toBeInTheDocument();
  });

  it('filters apps by search query from URL', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage('/?tab=shared&q=Shared');

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
  });

  it('shows shared app titles in grid view', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage('/?tab=shared&view=grid');

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
  });
});
