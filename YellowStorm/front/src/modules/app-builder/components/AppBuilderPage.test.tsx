import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeployedApp, DraftApp } from '../types';
import { emptyRevisionCatalog } from '../test-fixtures';

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

vi.mock('./hub/AppBuilderCreateWithAgent', () => ({
  AppBuilderCreateWithAgent: () => (
    <div data-testid='create-with-agent'>createWithAgent.title</div>
  ),
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
    ...emptyRevisionCatalog,
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
    ...emptyRevisionCatalog,
  },
];

const mockDrafts: DraftApp[] = [
  {
    sessionId: 'session-3',
    title: 'Draft app',
    lastUpdatedAt: '2026-07-15T10:00:00.000Z',
    deployStatus: 'idle',
    ...emptyRevisionCatalog,
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

async function selectStatus(label: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: /hub\.filters\.statusLabel/i }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

describe('AppBuilderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppBuilderStore.setState(initialState);
  });

  it('renders all apps by default', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage();

    expect(await screen.findByText('Generated app')).toBeInTheDocument();
    expect(screen.getByTestId('create-with-agent')).toBeInTheDocument();
    expect(screen.getByText('Shared app')).toBeInTheDocument();
    expect(screen.getByText('Draft app')).toBeInTheDocument();
  });

  it('shows create-with-agent section when the catalog is empty', async () => {
    listAppsMock.mockResolvedValueOnce({ deployed: [], shared: [], drafts: [] });

    renderPage();

    expect(await screen.findByTestId('create-with-agent')).toBeInTheDocument();
    expect(screen.getByText(/page\.empty/)).toBeInTheDocument();
  });

  it('switches to shared apps via status filter', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage();
    await screen.findByText('Generated app');

    await selectStatus(/hub\.status\.shared\.label/i);

    expect(await screen.findByText('Shared app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
  });

  it('switches to draft apps via status filter', async () => {
    listAppsMock.mockResolvedValueOnce(fullCatalog);

    renderPage();
    await screen.findByText('Generated app');

    await selectStatus(/hub\.status\.draft\.label/i);

    expect(await screen.findByText('Draft app')).toBeInTheDocument();
    expect(screen.queryByText('Generated app')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /card\.deleteDraft/i })).toBeInTheDocument();
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

  it('paginates deployed apps with nine cards per page', async () => {
    const deployedApps: DeployedApp[] = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `session-deployed-${index + 1}`,
      title: `Deployed app ${index + 1}`,
      deployedUrl: `https://apps.example/app-${index + 1}`,
      lastDeployedAt: '2026-07-17T10:00:00.000Z',
      source: 'owned',
      shareId: null,
      ...emptyRevisionCatalog,
    }));

    listAppsMock.mockResolvedValueOnce({
      deployed: deployedApps,
      shared: [],
      drafts: [],
    });

    renderPage();

    expect(await screen.findByText('Deployed app 1')).toBeInTheDocument();
    expect(screen.getByText('Deployed app 9')).toBeInTheDocument();
    expect(screen.queryByText('Deployed app 10')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hub\.pagination\.next/i }));

    expect(await screen.findByText('Deployed app 10')).toBeInTheDocument();
    expect(screen.queryByText('Deployed app 1')).not.toBeInTheDocument();
  });

  it('resets pagination when switching tabs', async () => {
    const deployedApps: DeployedApp[] = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `session-deployed-${index + 1}`,
      title: `Deployed app ${index + 1}`,
      deployedUrl: `https://apps.example/app-${index + 1}`,
      lastDeployedAt: '2026-07-17T10:00:00.000Z',
      source: 'owned',
      shareId: null,
      ...emptyRevisionCatalog,
    }));

    listAppsMock.mockResolvedValueOnce({
      deployed: deployedApps,
      shared: mockShared,
      drafts: [],
    });

    renderPage();
    await screen.findByText('Deployed app 1');

    fireEvent.click(screen.getByRole('button', { name: /hub\.pagination\.next/i }));
    expect(await screen.findByText('Deployed app 10')).toBeInTheDocument();

    await selectStatus(/hub\.status\.shared\.label/i);
    expect(await screen.findByText('Shared app')).toBeInTheDocument();

    await selectStatus(/hub\.status\.deployed\.label/i);
    expect(await screen.findByText('Deployed app 1')).toBeInTheDocument();
    expect(screen.getByText('Deployed app 9')).toBeInTheDocument();
    expect(screen.queryByText('Deployed app 10')).not.toBeInTheDocument();
  });
});
