import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_LIMIT } from './utils';
import { setWorkspaceTranslator, useWorkspaceStore } from './store';
import type { Workspace } from './types';

const workspaceApiMock = vi.hoisted(() => ({
  getWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  getDocuments: vi.fn(),
  addLinks: vi.fn(),
}));

const pageApiMock = vi.hoisted(() => ({
  listFolders: vi.fn().mockResolvedValue([]),
  listFiles: vi.fn().mockResolvedValue([]),
  assignFileToFolder: vi.fn().mockResolvedValue({}),
}));

const artifactApiMock = vi.hoisted(() => ({
  listWorkspaceArtifacts: vi.fn().mockResolvedValue([]),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('./api', () => workspaceApiMock);
vi.mock('./page-api', () => pageApiMock);
vi.mock('./artifact-api', () => artifactApiMock);
vi.mock('sonner', () => ({ toast: toastMock }));

function makeWorkspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    alias: `${id}-alias`,
    createdBy: 'user-1',
    documentCount: 0,
    usedStorage: 0,
    allocatedStorage: 1024,
    isSystem: false,
    isPersonal: true,
    shareCount: 0,
    isPublic: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('workspace store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWorkspaceTranslator();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  });

  it('fetches workspaces and auto-selects first workspace when modal is open', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace One');
    const ws2 = makeWorkspace('ws-2', 'Workspace Two');

    workspaceApiMock.getWorkspaces.mockResolvedValue({
      workspaces: [ws1, ws2],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 2, totalPages: 1 },
    });
    workspaceApiMock.getWorkspace.mockResolvedValue(ws1);
    workspaceApiMock.getDocuments.mockResolvedValue({
      documents: [],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 0, totalPages: 0 },
    });

    useWorkspaceStore.setState({ isModalOpen: true, selectedWorkspaceId: null });

    await act(async () => {
      await useWorkspaceStore.getState().fetchWorkspaces(1);
    });

    expect(workspaceApiMock.getWorkspaces).toHaveBeenCalledWith({
      page: 1,
      limit: DEFAULT_PAGE_LIMIT,
      search: undefined,
    });

    await waitFor(() => {
      const state = useWorkspaceStore.getState();
      expect(state.selectedWorkspaceId).toBe('ws-1');
      expect(state.selectedWorkspace?.id).toBe('ws-1');
    });
  });

  it('uses workspace cache for already loaded page', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace One');

    useWorkspaceStore.setState({
      workspaces: new Map([[2, [ws1]]]),
      searchQuery: '',
      currentPage: 1,
    });

    await act(async () => {
      await useWorkspaceStore.getState().fetchWorkspaces(2);
    });

    expect(workspaceApiMock.getWorkspaces).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().currentPage).toBe(2);
  });

  it('selects and switches workspace, resets document state, and closes mobile sidebar', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace One');
    const ws2Cached = makeWorkspace('ws-2', 'Workspace Two Cached');
    const ws2Fresh = makeWorkspace('ws-2', 'Workspace Two Fresh');

    workspaceApiMock.getWorkspace.mockResolvedValue(ws2Fresh);
    workspaceApiMock.getDocuments.mockResolvedValue({
      documents: [],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 0, totalPages: 0 },
    });

    useWorkspaceStore.setState({
      selectedWorkspaceId: 'ws-1',
      selectedWorkspace: ws1,
      workspaces: new Map([[1, [ws1, ws2Cached]]]),
      documents: new Map([[2, []]]),
      documentsCurrentPage: 2,
      documentSearchQuery: 'old-search',
      isMobileSidebarOpen: true,
    });

    await act(async () => {
      await useWorkspaceStore.getState().selectWorkspace('ws-2');
    });

    const state = useWorkspaceStore.getState();
    expect(state.selectedWorkspaceId).toBe('ws-2');
    expect(state.selectedWorkspace?.name).toBe('Workspace Two Fresh');
    expect(state.documentsCurrentPage).toBe(1);
    expect(state.documentSearchQuery).toBe('');
    expect(state.isMobileSidebarOpen).toBe(false);
    expect(workspaceApiMock.getWorkspace).toHaveBeenCalledWith('ws-2');
    expect(workspaceApiMock.getDocuments).toHaveBeenCalledWith('ws-2', {
      page: 1,
      limit: DEFAULT_PAGE_LIMIT,
      search: undefined,
    });
  });

  it('does not refetch when selecting the same workspace', async () => {
    useWorkspaceStore.setState({ selectedWorkspaceId: 'ws-1' });

    await act(async () => {
      await useWorkspaceStore.getState().selectWorkspace('ws-1');
    });

    expect(workspaceApiMock.getWorkspace).not.toHaveBeenCalled();
    expect(workspaceApiMock.getDocuments).not.toHaveBeenCalled();
  });

  it('updates selected workspace and cache via updateWorkspaceInCache', () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace One');
    const ws2 = makeWorkspace('ws-2', 'Workspace Two');

    useWorkspaceStore.setState({
      selectedWorkspaceId: 'ws-1',
      selectedWorkspace: ws1,
      workspaces: new Map([[1, [ws1, ws2]]]),
    });

    useWorkspaceStore.getState().updateWorkspaceInCache({ ...ws1, name: 'Workspace One Updated' });

    const state = useWorkspaceStore.getState();
    expect(state.selectedWorkspace?.name).toBe('Workspace One Updated');
    expect(state.workspaces.get(1)?.[0]?.name).toBe('Workspace One Updated');
  });

  it('openAddLink opens the dialog with url and autoStart, closeAddLink resets it', () => {
    act(() => { useWorkspaceStore.getState().openAddLink({ url: 'https://ex.com/services', autoStart: true }); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: 'https://ex.com/services', autoStart: true });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: false, initialUrl: '', autoStart: false });
  });

  it('openAddLink defaults to an empty url and no autoStart', () => {
    act(() => { useWorkspaceStore.getState().openAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: '', autoStart: false });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
  });

  it('addPageLinks assigns new links to the current folder', async () => {
    workspaceApiMock.addLinks.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
    useWorkspaceStore.setState({ selectedWorkspaceId: 'w1', pageCurrentFolderId: 'folder1' });
    await useWorkspaceStore.getState().addPageLinks('w1', ['https://a.com/x', 'https://b.com/y'], {});
    expect(pageApiMock.assignFileToFolder).toHaveBeenCalledWith('w1', 'd1', 'folder1');
    expect(pageApiMock.assignFileToFolder).toHaveBeenCalledWith('w1', 'd2', 'folder1');
  });

  it('addPageLinks does not assign when no folder is open', async () => {
    pageApiMock.assignFileToFolder.mockClear();
    workspaceApiMock.addLinks.mockResolvedValue([{ id: 'd1' }]);
    useWorkspaceStore.setState({ selectedWorkspaceId: 'w1', pageCurrentFolderId: null });
    await useWorkspaceStore.getState().addPageLinks('w1', ['https://a.com/x'], {});
    expect(pageApiMock.assignFileToFolder).not.toHaveBeenCalled();
  });
});
