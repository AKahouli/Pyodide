import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import type { RendererProps } from '../../types';
import { useFileViewerStore } from '../../store';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

type DocxPreviewModule = typeof import('docx-preview');

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function sanitizeRenderedDocx(container: HTMLElement) {
  container.querySelectorAll('script, iframe, object, embed').forEach((element) => element.remove());
  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;

    try {
      if (!SAFE_LINK_PROTOCOLS.has(new URL(href, window.location.href).protocol)) {
        anchor.removeAttribute('href');
      }
    } catch {
      anchor.removeAttribute('href');
    }
    anchor.rel = 'noopener noreferrer';
  });
}

export function DocxRenderer({ tab, isActive, onReady }: Readonly<RendererProps>) {
  const { t } = useModuleTranslation('file-viewer');
  const containerRef = useRef<HTMLDivElement>(null);
  const refreshTabUrl = useFileViewerStore((state) => state.refreshTabUrl);
  const [loadVersion, setLoadVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    const abortController = new AbortController();
    let cancelled = false;
    setIsLoading(true);
    setHasError(false);
    container.replaceChildren();

    async function renderDocx(activeContainer: HTMLDivElement) {
      const renderContainer = document.createElement('div');
      try {
        const response = await fetch(tab.url, { signal: abortController.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        const docxPreview: DocxPreviewModule = await import('docx-preview');
        if (cancelled) return;

        await docxPreview.renderAsync(buffer, renderContainer, renderContainer, {
          className: 'docx-preview',
          inWrapper: true,
          breakPages: true,
          ignoreWidth: true,
          useBase64URL: true,
          renderAltChunks: false,
        });
        if (cancelled) return;

        sanitizeRenderedDocx(renderContainer);
        activeContainer.replaceChildren(...renderContainer.childNodes);
        setIsLoading(false);
        onReady?.();
      } catch {
        if (cancelled || abortController.signal.aborted) return;
        activeContainer.replaceChildren();
        setHasError(true);
        setIsLoading(false);
      }
    }

    const timerId = window.setTimeout(() => void renderDocx(container), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      abortController.abort();
    };
  }, [isActive, loadVersion, onReady, tab.url]);

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = tab.url;
    link.download = tab.fileName;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [tab.fileName, tab.url]);

  const handleRetry = useCallback(async () => {
    const refreshedUrl = await refreshTabUrl(tab.id);
    if (!refreshedUrl || refreshedUrl === tab.url) {
      setLoadVersion((version) => version + 1);
    }
  }, [refreshTabUrl, tab.id, tab.url]);

  if (!isActive) return null;

  return (
    <div className='relative flex h-full flex-col bg-muted/30'>
      <div className='absolute right-3 top-3 z-10'>
        <Button
          variant='ghost'
          size='icon'
          className='h-9 w-9 border bg-background/90 shadow-sm backdrop-blur-sm'
          onClick={handleDownload}
          aria-label={t('docx.toolbar.download')}
          title={t('docx.toolbar.download')}
        >
          <Download className='h-4 w-4' />
        </Button>
      </div>

      {hasError && (
        <div className='absolute inset-0 z-[2] flex flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center text-sm'>
          <div>
            <p className='font-semibold text-destructive'>{t('docx.error.title')}</p>
            <p className='text-muted-foreground'>{t('docx.error.description')}</p>
          </div>
          <Button variant='outline' onClick={() => void handleRetry()}>
            <RefreshCw className='mr-2 h-4 w-4' />
            {t('actions.retry')}
          </Button>
        </div>
      )}

      {isLoading && !hasError && (
        <div className='absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-muted/30 text-muted-foreground'>
          <Loader2 className='h-8 w-8 animate-spin' />
          <p className='text-sm'>{t('docx.loading')}</p>
        </div>
      )}

      <div ref={containerRef} className='h-full overflow-auto p-4 [&_.docx-preview-wrapper]:min-h-full [&_.docx-preview-wrapper]:bg-transparent [&_section.docx-preview]:!max-w-full [&_section.docx-preview]:!w-full' />
    </div>
  );
}
