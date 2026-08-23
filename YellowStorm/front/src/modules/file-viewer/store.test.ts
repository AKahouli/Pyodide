import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileViewerStore } from './store';

const apiGetMock = vi.hoisted(() => vi.fn());

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
