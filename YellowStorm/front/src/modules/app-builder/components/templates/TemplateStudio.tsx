import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  getOrCreateHost,
  type BrowserRuntimeHost,
} from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import { runValidationPipeline } from './validation/pipeline';
import {
  createZipPreviewValidationStep,
  disposeZipValidationSession,
} from './validation/zip-preview-validation-step';
import { capturePreviewScreenshot } from './validation/capture-preview-screenshot';
import { waitForPreviewCaptureReady } from './validation/wait-for-preview-capture';
import { TemplateStudioBootState } from './TemplateStudioBootState';
import './template-studio-motion.css';

interface TemplateStudioProps {
  open: boolean;
  zipFile: File | null;
  onOpenChange: (open: boolean) => void;
  onValidated: (coverFile: File) => void;
}

function waitForPreviewUrl(host: BrowserRuntimeHost, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (host.state.previewUrl) {
      resolve(host.state.previewUrl);
      return;
    }
    const onAbort = () => {
      unsubscribe();
      reject(new Error('Validation cancelled.'));
    };
    const unsubscribe = host.subscribe((state) => {
      if (state.previewUrl) {
        signal.removeEventListener('abort', onAbort);
        unsubscribe();
        resolve(state.previewUrl);
      }
      if (state.status === 'error') {
        signal.removeEventListener('abort', onAbort);
        unsubscribe();
        reject(new Error(state.error || 'Template preview failed.'));
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function TemplateStudio({ open, zipFile, onOpenChange, onValidated }: TemplateStudioProps) {
  const { t } = useModuleTranslation('app-builder');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const runPreview = useCallback(
    async (signal: AbortSignal) => {
      if (!zipFile) return;

      setBooting(true);
      setError(null);
      setPreviewUrl(null);
      sessionIdRef.current = null;

      let activeSessionId: string | null = null;

      try {
        await runValidationPipeline(
          [createZipPreviewValidationStep(zipFile)],
          {
            signal,
            setSessionId: (id) => {
              activeSessionId = id;
              sessionIdRef.current = id;
            },
            setStagingTemplateId: () => undefined,
          },
          () => undefined,
        );

        const sid = activeSessionId;
        if (!sid) throw new Error('Preview session is not ready.');

        const host = getOrCreateHost(sid);
        const url = await waitForPreviewUrl(host, signal);
        if (signal.aborted) return;
        setPreviewUrl(url);
        setBooting(false);
      } catch (err) {
        setBooting(false);
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [zipFile],
  );

  useEffect(() => {
    if (!open || !zipFile) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void runPreview(controller.signal);

    return () => {
      controller.abort();
    };
  }, [open, zipFile, runPreview]);

  useEffect(() => {
    if (open) return;
    void disposeZipValidationSession(sessionIdRef.current);
    sessionIdRef.current = null;
    setPreviewUrl(null);
    setError(null);
    setBooting(false);
    setConfirming(false);
  }, [open]);

  // Register the visible iframe with the host as soon as the preview URL is ready
  // so confirm can capture without a destructive refresh cycle.
  useEffect(() => {
    if (!previewUrl || !sessionIdRef.current || !iframeRef.current) return;
    getOrCreateHost(sessionIdRef.current).attachPreviewIframe(iframeRef.current);
  }, [previewUrl]);

  const handleConfirm = async () => {
    const sid = sessionIdRef.current;
    const iframe = iframeRef.current;
    if (!sid || !iframe || !previewUrl || confirming) return;

    setConfirming(true);
    setError(null);
    try {
      const host = getOrCreateHost(sid);
      host.attachPreviewIframe(iframe);
      await waitForPreviewCaptureReady(host, iframe, new AbortController().signal);
      const coverFile = await capturePreviewScreenshot(iframe);
      onValidated(coverFile);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  };

  const ready = Boolean(previewUrl) && !booting && !error;
  const busy = booting || confirming;
  const showBoot = booting && !previewUrl && !error;

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        overlayClassName='bg-black/50 backdrop-blur-[2px]'
        closeLabel={t('templates.close')}
        aria-describedby={undefined}
        className={cn(
          'flex h-[min(90vh,52rem)] w-[calc(100%-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0',
          'border-border/70 bg-background shadow-2xl sm:rounded-2xl md:max-w-6xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-300',
          '[&>button]:right-4 [&>button]:top-4 [&>button]:rounded-md [&>button]:p-1.5',
          '[&>button]:hover:bg-muted [&>button]:hover:opacity-100',
        )}
      >
        <DialogHeader className='shrink-0 space-y-0 border-b border-border/60 px-5 py-4 pe-14 text-start sm:px-6'>
          <DialogTitle className='text-base font-semibold tracking-tight sm:text-lg'>
            {t('templateStudio.title')}
          </DialogTitle>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4'>
          {error ? (
            <p
              role='alert'
              className='shrink-0 animate-in fade-in-0 slide-in-from-top-1 rounded-lg bg-fail/10 px-3 py-2 text-sm text-fail duration-200'
            >
              {error}
            </p>
          ) : null}

          <div
            className={cn(
              'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60',
              'bg-muted/20 shadow-inner ring-1 ring-black/5',
            )}
          >
            {/* Browser chrome */}
            <div
              className='flex h-9 shrink-0 items-center gap-2 border-b border-border/50 bg-muted/60 px-3'
              aria-hidden={!ready}
            >
              <span className='size-2 rounded-full bg-border' />
              <span className='size-2 rounded-full bg-border' />
              <span className='size-2 rounded-full bg-border' />
              <div className='ms-1 flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/40 bg-background/70 px-2.5 py-1'>
                {ready ? (
                  <>
                    <span className='size-1.5 shrink-0 rounded-full bg-ok ts-live-dot' />
                    <span className='truncate text-[11px] text-muted-foreground'>
                      {t('templateStudio.livePreviewUrl')}
                    </span>
                  </>
                ) : (
                  <span className='truncate text-[11px] text-muted-foreground/70'>
                    {t('templateStudio.bootingUrl')}
                  </span>
                )}
              </div>
              {ready ? (
                <span className='hidden shrink-0 items-center gap-1.5 rounded-full bg-ok/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ok sm:inline-flex'>
                  <span className='size-1.5 rounded-full bg-ok' aria-hidden />
                  {t('templateStudio.liveBadge')}
                </span>
              ) : null}
            </div>

            <div className='relative min-h-0 flex-1'>
              {previewUrl ? (
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  title={t('templateStudio.previewTitle')}
                  className='absolute inset-0 size-full bg-background animate-in fade-in-0 duration-500'
                />
              ) : showBoot ? (
                <TemplateStudioBootState />
              ) : (
                <div className='flex h-full min-h-[16rem] items-center justify-center px-4 text-sm text-muted-foreground sm:min-h-[22rem]'>
                  {t('templateStudio.noPreview')}
                </div>
              )}

              {confirming ? (
                <>
                  <div className='pointer-events-none absolute inset-0 bg-background/55 backdrop-blur-[1px]' />
                  <div className='pointer-events-none absolute inset-0 bg-white/40 ts-capture-flash' />
                  <div className='absolute inset-0 flex items-center justify-center'>
                    <div className='flex items-center gap-2 rounded-full border border-border/60 bg-background/95 px-4 py-2 text-sm font-medium shadow-lg animate-in fade-in-0 zoom-in-95 duration-200'>
                      <Loader2 className='size-4 animate-spin text-primary' aria-hidden />
                      {t('templateStudio.confirming')}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter
          className={cn(
            'shrink-0 flex-col gap-3 border-t border-border/60 bg-muted/25 px-5 py-3.5 sm:px-6',
            'sm:flex-row sm:items-center sm:justify-between sm:space-x-0',
          )}
        >
          <p className='text-xs leading-relaxed text-muted-foreground sm:max-w-sm'>
            {confirming
              ? t('templateStudio.confirmingHint')
              : booting
                ? t('templateStudio.bootingHint')
                : t('templateStudio.footerHint')}
          </p>
          <div className='flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center'>
            <Button
              type='button'
              variant='outline'
              className='sm:min-w-[6.5rem]'
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('card.cancel')}
            </Button>
            <Button
              type='button'
              className={cn(
                'sm:min-w-[10.5rem]',
                ready && 'shadow-sm transition-transform duration-200 hover:scale-[1.02]',
              )}
              disabled={!ready || confirming}
              onClick={() => void handleConfirm()}
            >
              {confirming ? <Loader2 className='me-2 size-4 animate-spin' aria-hidden /> : null}
              {confirming ? t('templateStudio.confirming') : t('templateStudio.confirm')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
