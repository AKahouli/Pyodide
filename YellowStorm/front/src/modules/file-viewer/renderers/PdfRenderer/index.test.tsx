import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfRenderer } from './index';

const createPluginRegistrationMock = vi.hoisted(() => vi.fn((pkg, options) => ({ pkg, options })));
const usePdfiumEngineMock = vi.hoisted(() => vi.fn());

vi.mock('@embedpdf/core', () => ({
  createPluginRegistration: createPluginRegistrationMock,
}));

vi.mock('@embedpdf/core/react', () => ({
  EmbedPDF: ({ children }: { children: ReactNode }) => <div data-testid='embed-pdf'>{children}</div>,
}));

vi.mock('@embedpdf/engines/react', () => ({
  usePdfiumEngine: usePdfiumEngineMock,
}));

vi.mock('@embedpdf/plugin-document-manager/react', () => ({ DocumentManagerPluginPackage: { id: 'doc-manager' } }));
vi.mock('@embedpdf/plugin-viewport/react', () => ({ ViewportPluginPackage: { id: 'viewport' } }));
vi.mock('@embedpdf/plugin-scroll/react', () => ({ ScrollPluginPackage: { id: 'scroll' } }));
vi.mock('@embedpdf/plugin-render/react', () => ({ RenderPluginPackage: { id: 'render' } }));
vi.mock('@embedpdf/plugin-interaction-manager/react', () => ({ InteractionManagerPluginPackage: { id: 'interaction' } }));
vi.mock('@embedpdf/plugin-selection/react', () => ({ SelectionPluginPackage: { id: 'selection' } }));
vi.mock('@embedpdf/plugin-history/react', () => ({ HistoryPluginPackage: { id: 'history' } }));
vi.mock('@embedpdf/plugin-annotation/react', () => ({ AnnotationPluginPackage: { id: 'annotation' } }));
vi.mock('@embedpdf/plugin-search/react', () => ({ SearchPluginPackage: { id: 'search' } }));
vi.mock('@embedpdf/plugin-zoom/react', () => ({ ZoomPluginPackage: { id: 'zoom' } }));
vi.mock('@embedpdf/plugin-print/react', () => ({ PrintPluginPackage: { id: 'print' } }));
vi.mock('@embedpdf/plugin-export/react', () => ({ ExportPluginPackage: { id: 'export' } }));
vi.mock('@embedpdf/plugin-pan/react', () => ({ PanPluginPackage: { id: 'pan' } }));

vi.mock('../../store', () => ({
  useFileViewerPendingNavigation: () => null,
}));

vi.mock('./components/HeadlessViewer', () => ({
  HeadlessViewer: ({ tabId }: { tabId: string }) => <div>headless-{tabId}</div>,
}));

describe('PdfRenderer', () => {
  const tab = {
    id: 'pdf-1',
    fileName: 'doc.pdf',
    mimeType: 'application/pdf',
    url: 'https://example.test/doc.pdf',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows engine loading state', () => {
    usePdfiumEngineMock.mockReturnValue({ engine: null, isLoading: true, error: null });

    render(<PdfRenderer tab={tab} isActive registryRef={{ current: new Map() }} />);
    expect(screen.getByText('pdf.loadingEngine')).toBeInTheDocument();
  });

  it('shows engine error state', () => {
    usePdfiumEngineMock.mockReturnValue({ engine: { name: 'mock-engine' }, isLoading: false, error: new Error('engine failed') });

    render(<PdfRenderer tab={tab} isActive registryRef={{ current: new Map() }} />);
    expect(screen.getByText('pdf.loadingError.title')).toBeInTheDocument();
    expect(screen.getByText('engine failed')).toBeInTheDocument();
  });

  it('renders embed viewer with headless child when engine is ready', () => {
    usePdfiumEngineMock.mockReturnValue({ engine: { name: 'mock-engine' }, isLoading: false, error: null });

    render(<PdfRenderer tab={tab} isActive registryRef={{ current: new Map() }} />);

    expect(screen.getByTestId('embed-pdf')).toBeInTheDocument();
    expect(screen.getByText('headless-pdf-1')).toBeInTheDocument();
    expect(createPluginRegistrationMock).toHaveBeenCalled();
  });
});
