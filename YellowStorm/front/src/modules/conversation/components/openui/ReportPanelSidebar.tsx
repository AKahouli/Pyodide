import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useStore } from 'zustand';
import { Button } from '@/components/ui/button';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { useModuleTranslation } from '@/modules/localization';
import { reportPanelStore, useReportPanelActive } from './report-panel-store';

/**
 * Right-hand panel for the report of an OpenUI answer, next to the file viewer sidebar. The report
 * itself is rendered by the chip's component (see ReportBlock) and portaled into the node this panel
 * registers, so this file stays small and out of the lazy OpenUI chunk. Closes with its button or
 * Escape, when the conversation changes, and when the file viewer takes the right-hand slot.
 */
export function ReportPanelSidebar({ resetKey }: Readonly<{ resetKey?: string }>) {
  const { t } = useModuleTranslation('conversation');
  const active = useReportPanelActive();
  const setNode = useStore(reportPanelStore, (state) => state._setDetailedViewPanelNode);
  const setExportNode = useStore(reportPanelStore, (state) => state._setExportMenuNode);
  const viewerInSidebar = useFileViewerStore((state) => state.mode !== 'closed' && state.displayMode === 'sidebar');
  const close = useCallback(() => reportPanelStore.getState().reset(), []);

  useEffect(() => { if (active && viewerInSidebar) close(); }, [active, viewerInSidebar, close]);
  useEffect(() => { close(); return close; }, [resetKey, close]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, close]);

  if (!active) return null;
  return (
    <aside
      aria-label={t('openui.report.panelTitle')}
      data-testid='report-panel'
      className='fixed inset-0 z-50 flex flex-col bg-background md:static md:z-auto md:h-full md:w-[44rem] md:max-w-[55%] md:shrink-0 md:border-l'
    >
      <div className='flex h-10 shrink-0 items-center justify-between border-b bg-muted/50 px-3'>
        <span className='mr-2 truncate text-sm font-medium'>{t('openui.report.panelTitle')}</span>
        <div ref={setExportNode} className='ml-auto mr-1' />
        <Button variant='ghost' size='icon' className='h-6 w-6' onClick={close} aria-label={t('openui.report.close')}>
          <X className='h-3.5 w-3.5' />
        </Button>
      </div>
      {/* The viewer's own Edit button only changes the open copy and nothing stores it (there is no chat store behind the report), so it is hidden; only inside this host, and only that exact stock label. */}
      <div ref={setNode} className="flex min-h-0 flex-1 flex-col overflow-hidden [&_button[aria-label='Edit']]:hidden!" />
    </aside>
  );
}
