import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  getOrCreateHost,
  type BrowserRuntimeHost,
} from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import { runValidationPipeline, type StepProgress } from './validation/pipeline';
import {
  createZipNodepodValidationStep,
  disposeZipValidationSession,
} from './validation/zip-nodepod-validation-step';
import { capturePreviewScreenshot } from './validation/capture-preview-screenshot';
import { waitForPreviewCaptureReady } from './validation/wait-for-preview-capture';

interface TemplateValidatePreviewDialogProps {
  open: boolean;
  zipFile: File | null;
  onOpenChange: (open: boolean) => void;
  onValidated: (coverFile: File) => void;
}

const STATUS_ICON = {
  pending: null,
  running: Loader2,
  confirmed: CheckCircle2,
  failed: XCircle,
} as const;

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
        reject(new Error(state.error || 'NodePod preview failed.'));
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForRefElement(
  read: () => HTMLIFrameElement | null,
  signal: AbortSignal,
  timeoutMs = 15_000,
): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (signal.aborted) {
        reject(new Error('Validation cancelled.'));
        return;
      }
      const el = read();
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Preview iframe is not ready for capture.'));
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

export function TemplateValidatePreviewDialog({
  open,
  zipFile,
  onOpenChange,
  onValidated,
}: TemplateValidatePreviewDialogProps) {
  const { t } = useModuleTranslation('app-builder');
  const [steps, setSteps] = useState<StepProgress[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const stagingIdRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const attachIframe = useCallback((element: HTMLIFrameElement | null) => {
    iframeRef.current = element;
  }, []);

  const runValidation = useCallback(
    async (signal: AbortSignal) => {
      if (!zipFile) return;

      setRunning(true);
      setError(null);
      setConfirmed(false);
      setPreviewUrl(null);
      setSessionId(null);
      sessionIdRef.current = null;
      stagingIdRef.current = null;

      let activeSessionId: string | null = null;
      let activeStagingId: string | null = null;

      try {
        await runValidationPipeline(
          [createZipNodepodValidationStep(zipFile)],
          {
            signal,
            setSessionId: (id) => {
              activeSessionId = id;
              sessionIdRef.current = id;
              setSessionId(id);
            },
            setStagingTemplateId: (id) => {
              activeStagingId = id;
              stagingIdRef.current = id;
            },
          },
          setSteps,
        );

        const sid = activeSessionId;
        if (!sid) throw new Error('Preview session is not ready for capture.');

        const host = getOrCreateHost(sid);
        await waitForPreviewUrl(host, signal);

        flushSync(() => setPreviewUrl(host.state.previewUrl));

        const iframe = await waitForRefElement(() => iframeRef.current, signal);
        await waitForPreviewCaptureReady(host, iframe, signal);

        const coverFile = await capturePreviewScreenshot(iframe);
        setConfirmed(true);
        onValidated(coverFile);
        setRunning(false);
        onOpenChange(false);
      } catch (err) {
        setRunning(false);
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [zipFile, onValidated, onOpenChange],
  );

  useEffect(() => {
    if (!open || !zipFile) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void runValidation(controller.signal);

    return () => {
      controller.abort();
    };
  }, [open, zipFile, runValidation]);

  useEffect(() => {
    if (open) return;
    void disposeZipValidationSession(sessionIdRef.current, stagingIdRef.current);
    sessionIdRef.current = null;
    stagingIdRef.current = null;
    setSessionId(null);
    setPreviewUrl(null);
    setSteps([]);
    setConfirmed(false);
    setError(null);
    setRunning(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className='flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-hidden p-0'>
        <DialogHeader className='space-y-1 border-b px-6 py-4 text-left'>
          <DialogTitle>{t('validation.title')}</DialogTitle>
          <DialogDescription>{t('validation.zipDescription')}</DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6'>
          <ul className='space-y-2'>
            {steps.map((step) => {
              const Icon = STATUS_ICON[step.status];
              return (
                <li key={step.id} className='flex items-start gap-2.5 text-sm'>
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center',
                      step.status === 'confirmed' && 'text-ok',
                      step.status === 'failed' && 'text-fail',
                      step.status === 'running' && 'text-primary',
                    )}
                  >
                    {Icon ? (
                      <Icon
                        className={cn('size-4', step.status === 'running' && 'animate-spin')}
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <div className='min-w-0'>
                    <p className='font-medium text-foreground'>
                      {t(step.labelKey as Parameters<typeof t>[0])}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {step.status === 'pending' && t('validation.statusPending')}
                      {step.status === 'running' && t('validation.statusRunning')}
                      {step.status === 'confirmed' && t('validation.statusConfirmed')}
                      {step.status === 'failed' && (step.error ?? t('validation.statusFailed'))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {confirmed ? (
            <p className='rounded-lg bg-ok-soft/60 px-3 py-2 text-sm text-ok'>
              {t('templates.validationConfirmed')}
            </p>
          ) : null}

          {error ? (
            <p role='alert' className='rounded-lg bg-fail/10 px-3 py-2 text-sm text-fail'>
              {error}
            </p>
          ) : null}

          <div className='overflow-hidden rounded-xl border border-border/60 bg-muted/20'>
            {previewUrl ? (
              <div className='aspect-[16/10] w-full overflow-hidden bg-background'>
                <iframe
                  ref={attachIframe}
                  title={t('validation.previewTitle')}
                  className='size-full bg-background'
                />
              </div>
            ) : (
              <div className='flex aspect-[16/10] items-center justify-center text-sm text-muted-foreground'>
                {running ? t('validation.preparing') : t('validation.noPreview')}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
