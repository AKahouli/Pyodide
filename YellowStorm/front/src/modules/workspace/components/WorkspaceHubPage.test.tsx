import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceHubPage } from './WorkspaceHubPage';

const fixtures = vi.hoisted(() => {
  const workspace = {
    id: 'ws-1',
    name: 'Credit Risk',
    documentCount: 3,
    usedStorage: 1024,
    allocatedStorage: 2048,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isShared: false,
    isPersonal: false,
    isReadOnly: false,
  };
  return {
    workspace,
    storeState: {
      fetchWorkspaces: vi.fn(async () => undefined),
      fetchSharedWorkspaces: vi.fn(async () => undefined),
      fetchPublicWorkspaces: vi.fn(async () => undefined),
      openCreateModal: vi.fn(),
      openSettingsModal: vi.fn(),
      openShareModal: vi.fn(),
      deleteWorkspace: vi.fn(async () => undefined),
      error: null as string | null,
      workspaces: new Map<number, typeof workspace[]>([[1, [workspace]], [2, []]]),
      sharedWorkspaces: new Map<number, typeof workspace[]>([[1, []], [2, []]]),
      publicWorkspaces: new Map<number, typeof workspace[]>([[1, []], [2, []]]),
    },
  };
});
const { workspace, storeState } = fixtures;

const loadingState = vi.hoisted(() => ({ isLoadingWorkspaces: false }));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../store', () => {
  const useWorkspaceStore = Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    {
      getState: () => storeState,
      setState: (partial: Partial<typeof storeState>) => Object.assign(storeState, partial),
    },
  );
  return {
    useWorkspaceStore,
    useWorkspaceLoading: () => loadingState,
    useAllWorkspaces: () => [workspace],
  };
});

vi.mock('../hooks/useWorkspaceHubFilters', () => ({
  useWorkspaceHubFilters: () => ({
    counts: { personal: 0, mine: 1, shared: 0, public: 0 },
    filters: { owner: 'all', sort: 'updated', view: 'grid' },
    searchInput: '',
    filteredGroups: { personal: [], mine: [workspace], shared: [], public: [] },
    hasActiveFilters: false,
    isEmpty: false,
    setOwner: vi.fn(),
    setSearchInput: vi.fn(),
    setSort: vi.fn(),
    setView: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

vi.mock('./hub/WorkspaceHubOverview', () => ({ WorkspaceHubOverview: () => <div>workspace-overview</div> }));
vi.mock('./hub/WorkspaceHubFilters', () => ({ WorkspaceHubFilters: () => <div>workspace-filters</div> }));
vi.mock('./hub/WorkspaceHubGrid', () => ({ WorkspaceHubGrid: () => <div>workspace-grid</div> }));

describe('WorkspaceHubPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.error = null;
    loadingState.isLoadingWorkspaces = false;
    storeState.fetchWorkspaces.mockImplementation(async () => undefined);
  });

  it('renders translated hub controls and populated content', async () => {
    render(<MemoryRouter><WorkspaceHubPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'hub.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hub.create' })).toBeInTheDocument();
    expect(screen.getByText('workspace-grid')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'hub.create' }));
    expect(storeState.openCreateModal).toHaveBeenCalledOnce();
  });

  it('shows a recoverable aggregate loading error', async () => {
    storeState.fetchWorkspaces.mockImplementation(async () => {
      storeState.error = 'network failure';
    });

    render(<MemoryRouter><WorkspaceHubPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'hub.error.title' })).toBeInTheDocument();
    const callsBeforeRetry = storeState.fetchWorkspaces.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'hub.error.retry' }));
    await waitFor(() => expect(storeState.fetchWorkspaces.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });

  it('ignores a stale store error when cached aggregate data loads successfully', async () => {
    storeState.error = 'stale mutation failure';

    render(<MemoryRouter><WorkspaceHubPage /></MemoryRouter>);

    await waitFor(() => expect(storeState.fetchWorkspaces).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'hub.error.title' })).not.toBeInTheDocument();
    expect(screen.getByText('workspace-grid')).toBeInTheDocument();
  });
});
