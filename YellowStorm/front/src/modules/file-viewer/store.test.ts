import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileViewerStore } from './store';

const apiGetMock = vi.hoisted(() => vi.fn());

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGetMock },
  API_ENDPOINTS: {
    workspaceDocuments: {
      downloadUrl: (workspaceId: string, documentId: string) => `/workspaces/${workspaceId}/documents/${documentId}/download-url`,
    },
  },
}));

describe('file-viewer store', () => {
  beforeEach(() => {
    apiGetMock.mockReset().mockResolvedValue({
      data: {
        data: {
          url: 'https://example.test/file.pdf',
          expiresAt: '2026-08-23T13:00:00.000Z',
        },
      },
    });
    useFileViewerStore.setState({
      mode: 'closed',
      displayMode: 'floating',
      tabs: [],
      activeTabId: null,
      pendingNavigation: null,
      closeOnOutsideClick: false,
      position: { x: 0, y: 0 },
      size: { width: 900, height: 650 },
      minimizedPosition: { x: 50, y: 50 },
    });
  });

  it('opens url file and activates tab', () => {
    useFileViewerStore.getState().openFileFromUrl('https://example.test/a.txt', 'a.txt', 'text/plain');

    const state = useFileViewerStore.getState();
    expect(state.mode).toBe('open');
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe('url:https://example.test/a.txt');
  });

  it('opens a loading tab before an asynchronous url resolves', async () => {
    let resolveUrl!: (value: { url: string; fileName: string; mimeType: string }) => void;
    const load = vi.fn(() => new Promise<{ url: string; fileName: string; mimeType: string }>((resolve) => {
      resolveUrl = resolve;
    }));

    const opening = useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load, { displayMode: 'sidebar', page: 4 },
    );

    expect(useFileViewerStore.getState()).toMatchObject({
      mode: 'open',
      displayMode: 'sidebar',
      activeTabId: 'loader:citation-1',
      tabs: [{ id: 'loader:citation-1', url: '', isLoading: true }],
      pendingNavigation: { tabId: 'loader:citation-1', page: 4 },
    });

    resolveUrl({ url: 'https://example.test/report.pdf', fileName: 'report.pdf', mimeType: 'application/pdf' });
    await opening;

    expect(useFileViewerStore.getState().tabs[0]).toMatchObject({
      url: 'https://example.test/report.pdf',
      isLoading: false,
    });
  });

  it('reuses an in-flight url load for repeated opens', async () => {
    const deferred = createDeferred<{ url: string }>();
    const load = vi.fn(() => deferred.promise);

    const first = useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load, { page: 4 },
    );
    const second = useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load, { page: 7 },
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(useFileViewerStore.getState()).toMatchObject({
      tabs: [{ id: 'loader:citation-1', isLoading: true }],
      pendingNavigation: { tabId: 'loader:citation-1', page: 7 },
    });

    deferred.resolve({ url: 'https://example.test/report.pdf' });
    await Promise.all([first, second]);
  });

  it('ignores an older completion after closing and reopening a loader tab', async () => {
    const older = createDeferred<{ url: string }>();
    const newer = createDeferred<{ url: string }>();
    const load = vi.fn()
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const first = useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load,
    );
    useFileViewerStore.getState().closeTab('loader:citation-1');
    const second = useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load,
    );

    expect(load).toHaveBeenCalledTimes(2);
    newer.resolve({ url: 'https://example.test/newer.pdf' });
    await second;
    older.resolve({ url: 'https://example.test/older.pdf' });
    await first;

    expect(useFileViewerStore.getState().tabs[0]).toMatchObject({
      id: 'loader:citation-1',
      url: 'https://example.test/newer.pdf',
      isLoading: false,
    });
  });

  it('ignores an older rejection after a reopened tab succeeds', async () => {
    const older = createDeferred<{ url: string }>();
    const newer = createDeferred<{ url: string }>();
    const load = vi.fn()
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const first = useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load,
    );
    useFileViewerStore.getState().closeTab('loader:citation-1');
    const second = useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load,
    );

    newer.resolve({ url: 'https://example.test/newer.pdf' });
    await second;
    older.reject(new Error('expired request'));
    await expect(first).resolves.toBeUndefined();

    expect(useFileViewerStore.getState().tabs[0]).toMatchObject({
      id: 'loader:citation-1',
      url: 'https://example.test/newer.pdf',
      isLoading: false,
    });
  });

  it('rejects and closes a new tab when its current load fails', async () => {
    const load = vi.fn().mockRejectedValue(new Error('signing failed'));

    await expect(useFileViewerStore.getState().openFileFromUrlLoader(
      'citation-1', 'report.pdf', 'application/pdf', load,
    )).rejects.toThrow('signing failed');

    expect(useFileViewerStore.getState()).toMatchObject({
      mode: 'closed',
      tabs: [],
      activeTabId: null,
    });
  });

  it('opens a workspace document using the scoped download response', async () => {
    await useFileViewerStore.getState().openFile('workspace-1', 'document-1', 'internal/path.pdf', 'file.pdf', 'application/pdf');

    expect(apiGetMock).toHaveBeenCalledWith('/workspaces/workspace-1/documents/document-1/download-url');
    expect(useFileViewerStore.getState().tabs[0]).toMatchObject({
      id: 'workspace-1:document-1',
      url: 'https://example.test/file.pdf',
      urlExpiresAt: '2026-08-23T13:00:00.000Z',
      isLoading: false,
    });
  });

  it('refreshes a workspace document using the scoped download response', async () => {
    useFileViewerStore.setState({
      tabs: [{
        id: 'workspace-1:document-1',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
        path: 'internal/path.pdf',
        fileName: 'file.pdf',
        mimeType: 'application/pdf',
        url: 'https://example.test/expired.pdf',
      }],
    });

    await useFileViewerStore.getState().refreshTabUrl('workspace-1:document-1');

    expect(useFileViewerStore.getState().tabs[0]).toMatchObject({
      url: 'https://example.test/file.pdf',
      urlExpiresAt: '2026-08-23T13:00:00.000Z',
    });
  });

  it('keeps citation bbox in pending navigation', () => {
    useFileViewerStore.getState().openFileFromUrl('https://example.test/a.pdf', 'a.pdf', 'application/pdf', {
      page: 2,
      highlightText: 'exact quote',
      highlightBBox: [10, 20, 30, 40],
    });

    expect(useFileViewerStore.getState().pendingNavigation).toEqual({
      tabId: 'url:https://example.test/a.pdf',
      page: 2,
      highlightText: 'exact quote',
      highlightBBox: [10, 20, 30, 40],
      spreadsheet: undefined,
    });
  });

  it('enables outside-click dismissal only when requested', () => {
    useFileViewerStore.getState().openFileFromUrl('https://example.test/a.pdf', 'a.pdf', 'application/pdf', {
      closeOnOutsideClick: true,
    });

    expect(useFileViewerStore.getState().closeOnOutsideClick).toBe(true);
  });

  it('closes last tab and closes viewer', () => {
    const store = useFileViewerStore.getState();
    store.openFileFromUrl('https://example.test/a.txt', 'a.txt', 'text/plain');
    store.closeTab('url:https://example.test/a.txt');

    const state = useFileViewerStore.getState();
    expect(state.mode).toBe('closed');
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
  });

  it('enforces minimum window size when resizing', () => {
    useFileViewerStore.getState().setSize({ width: 100, height: 100 });
    const size = useFileViewerStore.getState().size;
    expect(size.width).toBe(480);
    expect(size.height).toBe(360);
  });
});
