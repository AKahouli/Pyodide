/**
 * Headless EmbedPDF viewer that mirrors the official documentation example.
 * We use the same plugin stack (document-manager, viewport, scroll, render)
 * so we can hook into `useCapability` and reliably auto-scroll to page 7.
 */

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import type { PluginRegistry } from '@embedpdf/core';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { Loader2 } from 'lucide-react';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll/react';
import { RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/react';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react';
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation/react';
import { SearchPluginPackage } from '@embedpdf/plugin-search/react';
import { ZoomPluginPackage } from '@embedpdf/plugin-zoom/react';
import { PrintPluginPackage } from '@embedpdf/plugin-print/react';
import { ExportPluginPackage } from '@embedpdf/plugin-export/react';
import { PanPluginPackage } from '@embedpdf/plugin-pan/react';
import type { PendingNavigation, RendererProps } from '../../types';
import { useFileViewerPendingNavigation } from '../../store';
import { HeadlessViewer } from './components/HeadlessViewer';
import { useModuleTranslation } from '@/modules/localization';

const FALLBACK_PAGE = 1;

interface PdfRendererInternalProps extends RendererProps {
  registryRef: MutableRefObject<Map<string, PluginRegistry>>;
  /**
   * Navigation driven by the host instead of the viewer store, for a viewer embedded outside the
   * file window (e.g. a document preview). A new object re-runs the scroll and highlight.
   */
  navigation?: PendingNavigation | null;
}

type PdfRendererProps = Readonly<PdfRendererInternalProps>;

export function PdfRenderer({ tab, isActive, registryRef, navigation }: PdfRendererProps) {
  const initialPageRef = useRef<number>(FALLBACK_PAGE);

  const storeNavigation = useFileViewerPendingNavigation();
  const pendingNavigation = navigation === undefined ? storeNavigation : navigation;
  const { engine, isLoading: isEngineLoading, error } = usePdfiumEngine();
  const { t } = useModuleTranslation('file-viewer');

  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [{ url: tab.url, documentId: tab.id, name: tab.fileName, autoActivate: true }],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage),
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(AnnotationPluginPackage),
      createPluginRegistration(SearchPluginPackage),
      createPluginRegistration(ZoomPluginPackage),
      createPluginRegistration(PrintPluginPackage),
      createPluginRegistration(ExportPluginPackage),
      createPluginRegistration(PanPluginPackage, { defaultMode: 'mobile' }),
    ],
    [tab.id, tab.url, tab.fileName],
  );

  useEffect(() => {
    if (typeof pendingNavigation?.page === 'number' && pendingNavigation.tabId === tab.id) {
      initialPageRef.current = pendingNavigation.page;
    }
  }, [pendingNavigation, tab.id]);

  if (isEngineLoading || !engine) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
        <span>{t('pdf.loadingEngine')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex h-full flex-col items-center justify-center text-center text-sm text-destructive'>
        <p>{t('pdf.loadingError.title')}</p>
        <p className='text-muted-foreground'>{error.message}</p>
      </div>
    );
  }

  return (
    <EmbedPDF key={`${tab.id}:${tab.url}`} engine={engine} plugins={plugins} autoMountDomElements={false}>
      <HeadlessViewer tabId={tab.id} isActive={isActive} pendingNavigation={pendingNavigation} registryRef={registryRef} initialPage={initialPageRef.current} />
    </EmbedPDF>
  );
}
