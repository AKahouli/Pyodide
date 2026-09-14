import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_LIMIT } from './utils';
import { setWorkspaceTranslator, useAllWorkspaces, useWorkspaceStore } from './store';
import type { Workspace } from './types';

const workspaceApiMock = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  getWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  getDocuments: vi.fn(),
  getPersonalWorkspace: vi.fn().mockResolvedValue(null),
  getAllFolders: vi.fn().mockResolvedValue([]),
  addLinks: vi.fn(),
  initiateBulkUpload: vi.fn(),
  uploadToAzure: vi.fn(),
  completeBulkUpload: vi.fn(),
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

  it('fetches workspaces into cache without auto-selecting', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace One');
    const ws2 = makeWorkspace('ws-2', 'Workspace Two');

    workspaceApiMock.getWorkspaces.mockResolvedValue({
      workspaces: [ws1, ws2],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 2, totalPages: 1 },
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
      expect(state.workspaces.get(1)?.map((w) => w.id)).toEqual(['ws-1', 'ws-2']);
      expect(state.selectedWorkspaceId).toBeNull();
      expect(state.isLoadingWorkspaces).toBe(false);
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

  it('returns all cached workspace pages regardless of the current page', () => {
    const created = makeWorkspace('ws-created', 'Created Workspace');
    const lastPage = makeWorkspace('ws-last', 'Last Workspace');
    useWorkspaceStore.setState({
      workspaces: new Map([[1, [created]], [4, [lastPage]]]),
      currentPage: 4,
    });

    const { result } = renderHook(() => useAllWorkspaces());

    expect(result.current.map((workspace) => workspace.id)).toEqual(['ws-created', 'ws-last']);
  });

  it('keeps parallel workspace page responses in the cache', async () => {
    const firstPage = makeWorkspace('ws-1', 'First Page');
    const secondPage = { ...makeWorkspace('ws-2', 'Second Page'), isPersonal: false };
    let resolveFirstPage!: (value: unknown) => void;
    let resolveSecondPage!: (value: unknown) => void;
    workspaceApiMock.getWorkspaces
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirstPage = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecondPage = resolve; }));

    const firstRequest = useWorkspaceStore.getState().fetchWorkspaces(1);
    const secondRequest = useWorkspaceStore.getState().fetchWorkspaces(2);
    resolveSecondPage({
      workspaces: [secondPage],
      pagination: { page: 2, limit: DEFAULT_PAGE_LIMIT, total: 2, totalPages: 2 },
    });
    await secondRequest;
    resolveFirstPage({
      workspaces: [firstPage],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 2, totalPages: 2 },
    });
    await firstRequest;

    expect(Array.from(useWorkspaceStore.getState().workspaces.keys()).sort()).toEqual([1, 2]);
  });

  it('invalidateWorkspaceCache clears the cache and search filter so refetches are unfiltered', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace One');
    workspaceApiMock.getWorkspaces.mockResolvedValue({
      workspaces: [ws1],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 1, totalPages: 1 },
    });

    await act(async () => {
      await useWorkspaceStore.getState().searchWorkspaces('personal');
    });
    expect(useWorkspaceStore.getState().searchQuery).toBe('personal');

    act(() => {
      useWorkspaceStore.getState().invalidateWorkspaceCache();
    });

    expect(useWorkspaceStore.getState().searchQuery).toBe('');
    expect(useWorkspaceStore.getState().workspaces.size).toBe(0);

    workspaceApiMock.getWorkspaces.mockClear();
    await act(async () => {
      await useWorkspaceStore.getState().fetchWorkspaces(1);
    });
    expect(workspaceApiMock.getWorkspaces).toHaveBeenCalledWith({
      page: 1,
      limit: DEFAULT_PAGE_LIMIT,
      search: undefined,
    });
  });

  it('keeps a newly created workspace when the refreshed list is stale', async () => {
    const existing = makeWorkspace('ws-1', 'Existing Workspace');
    const created = { ...makeWorkspace('ws-2', 'Created Workspace'), isPersonal: false };
    workspaceApiMock.createWorkspace.mockResolvedValue(created);
    workspaceApiMock.getWorkspaces.mockResolvedValue({
      workspaces: [existing],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 1, totalPages: 1 },
    });

    await act(async () => {
      await useWorkspaceStore.getState().createWorkspace({ name: created.name });
    });

    expect(useWorkspaceStore.getState().workspaces.get(1)?.map((workspace) => workspace.id)).toEqual([
      'ws-1',
      'ws-2',
    ]);
    expect(useWorkspaceStore.getState().totalWorkspaces).toBe(2);
  });

  it('ignores an older workspace fetch that resolves after creation', async () => {
    const oldWorkspace = makeWorkspace('ws-old', 'Old Workspace');
    const created = { ...makeWorkspace('ws-new', 'Created Workspace'), isPersonal: false };
    let resolveOldFetch!: (value: unknown) => void;
    const oldFetch = new Promise((resolve) => {
      resolveOldFetch = resolve;
    });

    workspaceApiMock.getWorkspaces
      .mockReturnValueOnce(oldFetch)
      .mockResolvedValueOnce({
        workspaces: [oldWorkspace],
        pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 1, totalPages: 1 },
      });
    workspaceApiMock.createWorkspace.mockResolvedValue(created);

    const pendingFetch = useWorkspaceStore.getState().fetchWorkspaces(1);
    await useWorkspaceStore.getState().createWorkspace({ name: created.name });

    resolveOldFetch({
      workspaces: [oldWorkspace],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 1, totalPages: 1 },
    });
    await pendingFetch;

    expect(useWorkspaceStore.getState().workspaces.get(1)?.map((workspace) => workspace.id)).toEqual([
      'ws-old',
      'ws-new',
    ]);
  });

  it('ignores an older workspace fetch error after creation starts a refresh', async () => {
    const created = { ...makeWorkspace('ws-new', 'Created Workspace'), isPersonal: false };
    let rejectOldFetch!: (reason: Error) => void;
    const oldFetch = new Promise((_, reject) => {
      rejectOldFetch = reject;
    });

    workspaceApiMock.getWorkspaces
      .mockReturnValueOnce(oldFetch)
      .mockResolvedValueOnce({
        workspaces: [],
        pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 0, totalPages: 0 },
      });
    workspaceApiMock.createWorkspace.mockResolvedValue(created);

    const pendingFetch = useWorkspaceStore.getState().fetchWorkspaces(1);
    await useWorkspaceStore.getState().createWorkspace({ name: created.name });
    rejectOldFetch(new Error('stale request failed'));
    await pendingFetch;

    const state = useWorkspaceStore.getState();
    expect(state.workspaces.get(1)?.map((workspace) => workspace.id)).toEqual(['ws-new']);
    expect(state.error).toBeNull();
    expect(state.isLoadingWorkspaces).toBe(false);
  });

  it('keeps a created workspace within the regular page limit when personal workspace is present', async () => {
    const personal = makeWorkspace('personal', 'Personal Workspace');
    const existing = Array.from({ length: DEFAULT_PAGE_LIMIT - 1 }, (_, index) => ({
      ...makeWorkspace(`ws-${index}`, `Workspace ${index}`),
      isPersonal: false,
    }));
    const created = { ...makeWorkspace('ws-new', 'Created Workspace'), isPersonal: false };
    workspaceApiMock.getPersonalWorkspace.mockResolvedValue(personal);
    workspaceApiMock.getWorkspaces.mockResolvedValue({
      workspaces: [personal, ...existing],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: DEFAULT_PAGE_LIMIT, totalPages: 1 },
    });
    workspaceApiMock.createWorkspace.mockResolvedValue(created);

    await useWorkspaceStore.getState().createWorkspace({ name: created.name });

    const page = useWorkspaceStore.getState().workspaces.get(1) ?? [];
    expect(page).toHaveLength(DEFAULT_PAGE_LIMIT);
    expect(page.slice(0, 2).map((workspace) => workspace.id)).toEqual(['personal', 'ws-new']);
    expect(useWorkspaceStore.getState().totalWorkspaces).toBe(DEFAULT_PAGE_LIMIT + 1);
    expect(useWorkspaceStore.getState().totalPages).toBe(2);
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
      parentId: null,
    });
    expect(workspaceApiMock.getAllFolders).toHaveBeenCalledWith('ws-2');
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
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: 'https://ex.com/services', autoStart: true, seed: [] });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: false, initialUrl: '', autoStart: false, seed: [] });
  });

  it('openAddLink defaults to an empty url and no autoStart', () => {
    act(() => { useWorkspaceStore.getState().openAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: '', autoStart: false, seed: [] });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
  });

  it('openAddLink carries a seed and closeAddLink clears it', () => {
    const seed = [{ url: 'https://a.com/x', name: 'X', indexingStatus: 'ready' }];
    act(() => { useWorkspaceStore.getState().openAddLink({ url: 'https://a.com', autoStart: true, seed }); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: 'https://a.com', autoStart: true, seed });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: false, initialUrl: '', autoStart: false, seed: [] });
  });

  it('openAddLink defaults seed to empty', () => {
    act(() => { useWorkspaceStore.getState().openAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog.seed).toEqual([]);
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

  it('updateDocumentIndexingStatus updates pageFiles as well as documents cache', () => {
    useWorkspaceStore.setState({
      pageFiles: [
        {
          id: 'doc-1',
          workspaceId: 'w1',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          size: 10,
          folderId: null,
          status: 'completed',
          indexingStatus: 'none',
          type: 'doc',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as never,
      ],
      documents: new Map([
        [
          1,
          [
            {
              id: 'doc-1',
              originalName: 'a.pdf',
              indexingStatus: 'none',
            } as never,
          ],
        ],
      ]),
    });

    useWorkspaceStore.getState().updateDocumentIndexingStatus('doc-1', 'processing', undefined, undefined);

    const state = useWorkspaceStore.getState();
    expect(state.pageFiles[0].indexingStatus).toBe('processing');
    expect(state.documents.get(1)?.[0].indexingStatus).toBe('processing');
  });

  it('startUpload bulk waits for complete and passes autoIndex=true', async () => {
    const fileA = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const fileB = new File(['b'], 'b.pdf', { type: 'application/pdf' });

    workspaceApiMock.initiateBulkUpload.mockResolvedValue({
      sessionId: 'session-1',
      files: [
        { index: 0, filename: 'a.pdf', uploadUrl: 'https://upload/a', documentId: 'd1' },
        { index: 1, filename: 'b.pdf', uploadUrl: 'https://upload/b', documentId: 'd2' },
      ],
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    workspaceApiMock.uploadToAzure.mockResolvedValue(undefined);
    workspaceApiMock.completeBulkUpload.mockResolvedValue({
      sessionId: 'session-1',
      status: 'success',
      totalFiles: 2,
      successful: { count: 2, documents: [] },
      failed: { count: 0, files: [] },
      duration: 5,
    });
    workspaceApiMock.getWorkspace.mockResolvedValue(makeWorkspace('w1', 'W1'));
    workspaceApiMock.getDocuments.mockResolvedValue({
      documents: [],
      pagination: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 0, totalPages: 0 },
    });

    useWorkspaceStore.setState({
      selectedWorkspaceId: 'w1',
      uploadQueue: [
        {
          id: 'q1',
          file: fileA,
          workspaceId: 'w1',
          status: 'pending',
          progress: 0,
        },
        {
          id: 'q2',
          file: fileB,
          workspaceId: 'w1',
          status: 'pending',
          progress: 0,
        },
      ],
    });

    await act(async () => {
      await useWorkspaceStore.getState().startUpload(false, true);
    });

    expect(workspaceApiMock.completeBulkUpload).toHaveBeenCalledWith('w1', 'session-1', false, true);
    expect(workspaceApiMock.uploadToAzure).toHaveBeenCalledTimes(2);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('startUpload bulk marks queue failed and rethrows when complete fails', async () => {
    const fileA = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const fileB = new File(['b'], 'b.pdf', { type: 'application/pdf' });

    workspaceApiMock.initiateBulkUpload.mockResolvedValue({
      sessionId: 'session-1',
      files: [
        { index: 0, filename: 'a.pdf', uploadUrl: 'https://upload/a', documentId: 'd1' },
        { index: 1, filename: 'b.pdf', uploadUrl: 'https://upload/b', documentId: 'd2' },
      ],
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    workspaceApiMock.uploadToAzure.mockResolvedValue(undefined);
    workspaceApiMock.completeBulkUpload.mockRejectedValue(new Error('complete failed'));

    useWorkspaceStore.setState({
      selectedWorkspaceId: 'w1',
      uploadQueue: [
        { id: 'q1', file: fileA, workspaceId: 'w1', status: 'pending', progress: 0 },
        { id: 'q2', file: fileB, workspaceId: 'w1', status: 'pending', progress: 0 },
      ],
    });

    await act(async () => {
      await expect(useWorkspaceStore.getState().startUpload(false, true)).rejects.toThrow(
        'complete failed',
      );
    });

    expect(toastMock.error).toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
