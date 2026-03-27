import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileViewerStore } from './store';

vi.mock('../workspace/api', () => ({
  getDocumentDownloadUrl: vi.fn().mockResolvedValue({
    url: 'https://example.test/file.pdf',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
}));

describe('file-viewer store', () => {
  beforeEach(() => {
    useFileViewerStore.setState({
      mode: 'closed',
      displayMode: 'floating',
      tabs: [],
      activeTabId: null,
      pendingNavigation: null,
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
