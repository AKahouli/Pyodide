import { fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HeadlessViewer } from './HeadlessViewer';

const getSelectedTextWaitMock = vi.hoisted(() => vi.fn());
const registrySetPluginMock = vi.hoisted(() => vi.fn());

vi.mock('@embedpdf/core/react', () => ({
  useRegistry: () => ({
    activeDocumentId: 'doc-1',
    registry: {
      getPlugin: registrySetPluginMock,
    },
  }),
}));

vi.mock('@embedpdf/plugin-document-manager/react', () => ({
  DocumentContent: ({ children }: { children: (state: { isLoading: boolean; isLoaded: boolean; isError: boolean }) => ReactNode }) => (
    <>{children({ isLoading: false, isLoaded: true, isError: false })}</>
  ),
}));

vi.mock('@embedpdf/plugin-viewport/react', () => ({ Viewport: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@embedpdf/plugin-scroll/react', () => ({ Scroller: ({ renderPage }: { renderPage: (args: { pageIndex: number }) => ReactNode }) => <>{renderPage({ pageIndex: 0 })}</> }));
vi.mock('@embedpdf/plugin-render/react', () => ({ RenderLayer: () => <div>render-layer</div> }));
vi.mock('@embedpdf/plugin-interaction-manager/react', () => ({
  GlobalPointerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  PagePointerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@embedpdf/plugin-selection/react', () => ({ SelectionLayer: () => <div>selection-layer</div> }));
vi.mock('@embedpdf/plugin-annotation/react', () => ({ AnnotationLayer: () => <div>annotation-layer</div> }));
vi.mock('@embedpdf/plugin-search/react', () => ({ SearchLayer: () => <div>search-layer</div> }));
vi.mock('@embedpdf/plugin-print/react', () => ({ PrintFrame: () => <div>print-frame</div> }));
vi.mock('@embedpdf/plugin-export/react', () => ({ Download: () => <div>export-download</div> }));
vi.mock('@embedpdf/plugin-pan/react', () => ({ PanMode: () => <div>pan-mode</div> }));

vi.mock('./ScrollToPageOnLoad', () => ({ ScrollToPageOnLoad: () => null }));
vi.mock('./PendingNavigationEffect', () => ({ PendingNavigationEffect: () => null }));
vi.mock('./HighlightOnLoad', () => ({ HighlightOnLoad: () => null }));
vi.mock('./ViewerToolbar', () => ({ ViewerToolbar: () => <div>toolbar</div> }));
vi.mock('./SearchControls', () => ({ SearchControls: () => <div>search-controls</div> }));

describe('HeadlessViewer', () => {
  it('registers tab registry and handles copy shortcut with selected text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    registrySetPluginMock.mockReturnValue({
      provides: () => ({
        forDocument: () => ({
          getSelectedText: () => ({
            wait: (onSuccess: (lines: string[]) => void) => {
              getSelectedTextWaitMock();
              onSuccess(['hello', 'world']);
            },
          }),
        }),
      }),
    });

    const registryRef = { current: new Map() };
    const { unmount } = render(
      <HeadlessViewer
        tabId='tab-1'
        isActive
        pendingNavigation={null}
        registryRef={registryRef as never}
        initialPage={1}
      />,
    );

    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    expect(getSelectedTextWaitMock).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('hello\nworld');
    expect(registryRef.current.has('tab-1')).toBe(true);

    unmount();
    expect(registryRef.current.has('tab-1')).toBe(false);
  });
});
