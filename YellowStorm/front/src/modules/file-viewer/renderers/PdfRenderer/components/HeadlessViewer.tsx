import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { useRegistry } from '@embedpdf/core/react';
import type { PluginRegistry } from '@embedpdf/core';
import { Loader2 } from 'lucide-react';
import { DocumentContent } from '@embedpdf/plugin-document-manager/react';
import { Viewport } from '@embedpdf/plugin-viewport/react';
import { Scroller } from '@embedpdf/plugin-scroll/react';
import { RenderLayer } from '@embedpdf/plugin-render/react';
import { GlobalPointerProvider, PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { SelectionLayer } from '@embedpdf/plugin-selection/react';
import { AnnotationLayer } from '@embedpdf/plugin-annotation/react';
import { SearchLayer } from '@embedpdf/plugin-search/react';
import { PrintFrame } from '@embedpdf/plugin-print/react';
import { Download as ExportDownloadUtility } from '@embedpdf/plugin-export/react';
import { PanMode } from '@embedpdf/plugin-pan/react';
import type { PendingNavigation } from '@/modules/file-viewer/types';
import { ScrollToPageOnLoad } from './ScrollToPageOnLoad';
import { PendingNavigationEffect } from './PendingNavigationEffect';
import { ViewerToolbar } from './ViewerToolbar';
import { HighlightOnLoad } from './HighlightOnLoad';
import { SearchControls } from './SearchControls';
import { CitationBBoxOverlay } from './CitationBBoxOverlay';
import { extractHighlightText } from '../utils/text';
import { useModuleTranslation } from '@/modules/localization';

type HeadlessViewerProps = Readonly<{
  tabId: string;
  isActive: boolean;
  pendingNavigation: PendingNavigation | null;
  registryRef: MutableRefObject<Map<string, PluginRegistry>>;
  initialPage: number;
}>;

// Fallback copy function for older browsers
function fallbackCopy(text: string): void {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

export function HeadlessViewer({ tabId, isActive, pendingNavigation, registryRef, initialPage }: HeadlessViewerProps) {
  const { registry, activeDocumentId } = useRegistry();
  const pendingHighlightText = extractHighlightText(pendingNavigation?.highlightText);
  const { t } = useModuleTranslation('file-viewer');

  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Setup copy handler for PDF text selection (Ctrl+C / Cmd+C)
  useEffect(() => {
    if (!activeDocumentId || !registry) return;

    const plugin = registry.getPlugin('selection');
    if (!plugin?.provides) return;

    const selectionPlugin = plugin.provides();
    if (!selectionPlugin) return;

    const docSelection = selectionPlugin.forDocument(activeDocumentId);
    if (!docSelection) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Check if there's a selection and copy it to system clipboard
        docSelection.getSelectedText().wait(
          (lines: string[]) => {
            const hasSelection = lines?.some((l) => l.trim().length > 0);

            if (hasSelection) {
              e.preventDefault();
              e.stopPropagation();

              // Join lines with newlines and copy to system clipboard
              const textToCopy = lines.join('\n');

              // Use Clipboard API with fallback
              navigator.clipboard.writeText(textToCopy).catch(() => fallbackCopy(textToCopy));
            }
          },
          () => {},
        );
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [activeDocumentId, registry]);

  // Prevent native drag on PDF pages — stops browser from creating drag images
  // that the conversation input's globalDrop handler would pick up as file attachments
  const preventDragStart = useCallback((e: React.DragEvent) => {
    const selection = globalThis.getSelection();
    // Only prevent drag if user is NOT selecting text
    if (selection?.type !== 'Range' || selection.toString().trim() === '') {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (!registry) return;
    registryRef.current.set(tabId, registry);
    return () => {
      registryRef.current.delete(tabId);
    };
  }, [registry, registryRef, tabId]);

  if (!activeDocumentId) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
        <span>{t('pdf.preparing')}</span>
      </div>
    );
  }

  return (
    <DocumentContent documentId={activeDocumentId}>
      {({ isLoading, isLoaded, isError }) => {
        if (isLoading) {
          return (
            <div className='flex h-full items-center justify-center text-muted-foreground'>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              <span>{t('pdf.opening')}</span>
            </div>
          );
        }

        if (isError) {
          return (
            <div className='flex h-full flex-col items-center justify-center text-center text-sm text-destructive'>
              <p>{t('pdf.documentError.title')}</p>
              <p className='text-muted-foreground'>{t('pdf.documentError.description')}</p>
            </div>
          );
        }

        if (!isLoaded) {
          return null;
        }

        return (
          <div className='flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm'>
            <ScrollToPageOnLoad documentId={activeDocumentId} initialPage={initialPage} />
            <PendingNavigationEffect documentId={activeDocumentId} tabId={tabId} isActive={isActive} pendingNavigation={pendingNavigation} />
            <HighlightOnLoad documentId={activeDocumentId} text={pendingHighlightText} />
            <ViewerToolbar documentId={activeDocumentId} />
            <SearchControls documentId={activeDocumentId} />
            <PanMode />
            <PrintFrame />
            <ExportDownloadUtility />
            <div ref={pdfContainerRef} className='relative flex-1 bg-muted/40 dark:bg-muted/20' onDragStart={preventDragStart}>
              <Viewport documentId={activeDocumentId} className='absolute inset-0'>
                <GlobalPointerProvider documentId={activeDocumentId} style={{ position: 'absolute', inset: 0 }}>
                  <Scroller
                    documentId={activeDocumentId}
                    renderPage={({ pageIndex }) => (
                      <PagePointerProvider documentId={activeDocumentId} pageIndex={pageIndex}>
                        <RenderLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                        <SelectionLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                        <AnnotationLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                        <SearchLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                        <CitationBBoxOverlay bbox={pendingNavigation?.highlightBBox} documentId={activeDocumentId} page={pendingNavigation?.page} pageIndex={pageIndex} />
                      </PagePointerProvider>
                    )}
                  />
                </GlobalPointerProvider>
              </Viewport>
            </div>
          </div>
        );
      }}
    </DocumentContent>
  );
}
