import { useEffect, useMemo, useState } from 'react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { useZoom } from '@embedpdf/plugin-zoom/react';
import { usePrint } from '@embedpdf/plugin-print/react';
import { useExport } from '@embedpdf/plugin-export/react';
import { usePan } from '@embedpdf/plugin-pan/react';
import { ChevronLeft, ChevronRight, Download, Hand, MousePointer2, Printer, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';

type ViewerToolbarProps = Readonly<{ documentId: string }>;

export function ViewerToolbar({ documentId }: ViewerToolbarProps) {
  const { provides: scroll, state } = useScroll(documentId);
  const [pageInput, setPageInput] = useState('1');
  const { state: zoomState, provides: zoom } = useZoom(documentId);
  const { provides: printScope } = usePrint(documentId);
  const { provides: exportScope } = useExport(documentId);
  const { provides: pan, isPanning } = usePan(documentId);
  const { t } = useModuleTranslation('file-viewer');

  useEffect(() => {
    if (state.currentPage) {
      setPageInput(String(state.currentPage));
    }
  }, [state.currentPage]);

  const totalPages = state.totalPages || 1;
  const zoomPercent = useMemo(() => {
    const currentZoom = zoomState.currentZoomLevel || 1;
    return `${Math.round(currentZoom * 100)}%`;
  }, [zoomState.currentZoomLevel]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = Number(pageInput);
    if (!scroll || Number.isNaN(target)) return;
    if (target >= 1 && target <= totalPages) {
      scroll.scrollToPage({ pageNumber: target });
    }
  };

  const baseButtonClass = 'inline-flex items-center justify-center rounded-md bg-background text-foreground shadow-sm ring-1 ring-border transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
  const squareButtonClass = `${baseButtonClass} h-7 w-7`;
  const largeSquareButtonClass = `${baseButtonClass} h-8 w-8`;
  const textButtonClass = `${baseButtonClass} h-8 px-3 text-xs font-medium gap-1`;

  const handlePrint = () => {
    const task = printScope?.print();
    task?.toPromise().catch(() => {
      toast.error(t('toolbar.printFailed.title'), { description: t('toolbar.printFailed.description') });
    });
  };

  const handleDownload = () => {
    try {
      exportScope?.download();
    } catch (error) {
      toast.error(t('toolbar.downloadFailed.title'), { description: error instanceof Error ? error.message : t('toolbar.downloadFailed.description') });
    }
  };

  return (
    <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs'>
      <div className='flex items-center gap-2'>
        <button onClick={() => scroll?.scrollToPreviousPage()} disabled={!scroll || (state.currentPage ?? 1) <= 1} className={squareButtonClass} title={t('tooltip.previousPage')}>
          <ChevronLeft className='h-4 w-4' />
        </button>

        <form onSubmit={handleSubmit} className='flex items-center gap-1.5 text-[11px] uppercase tracking-wide'>
          <span>{t('toolbar.pageLabel')}</span>
          <input type='number' min={1} max={totalPages} value={pageInput} onChange={(event) => setPageInput(event.target.value)} className='h-7 w-14 rounded border border-border bg-background text-center text-sm font-mono' />
          <span>/ {totalPages}</span>
        </form>

        <button onClick={() => scroll?.scrollToNextPage()} disabled={!scroll || (state.currentPage ?? 1) >= totalPages} className={squareButtonClass} title={t('tooltip.nextPage')}>
          <ChevronRight className='h-4 w-4' />
        </button>
      </div>

      <div className='flex items-center gap-2 text-[11px] uppercase tracking-wide'>
        <div className='flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm'>
          <button onClick={() => zoom?.zoomOut()} disabled={!zoom} className={largeSquareButtonClass} title={t('tooltip.zoomOut')}>
            <ZoomOut className='h-4 w-4' />
          </button>
          <span className='w-14 text-center font-mono text-sm'>{zoomPercent}</span>
          <button onClick={() => zoom?.zoomIn()} disabled={!zoom} className={largeSquareButtonClass} title={t('tooltip.zoomIn')}>
            <ZoomIn className='h-4 w-4' />
          </button>
        </div>

        <button onClick={() => pan?.togglePan()} disabled={!pan} className={`${squareButtonClass} ${isPanning ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`} title={isPanning ? t('tooltip.selectionTool') : t('tooltip.handTool')}>
          {isPanning ? <Hand className='h-4 w-4' /> : <MousePointer2 className='h-4 w-4' />}
        </button>

        <button onClick={handlePrint} disabled={!printScope} className={textButtonClass} title={t('tooltip.print')}>
          <Printer className='h-3.5 w-3.5' />
          {t('toolbar.print')}
        </button>

        <button onClick={handleDownload} disabled={!exportScope} className={textButtonClass} title={t('tooltip.download')}>
          <Download className='h-3.5 w-3.5' />
          {t('toolbar.download')}
        </button>
      </div>
    </div>
  );
}
