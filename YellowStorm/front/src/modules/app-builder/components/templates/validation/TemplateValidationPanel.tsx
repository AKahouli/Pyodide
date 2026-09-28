import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { conversationV2Api } from '@/modules/conversation-v2/api';
import {
  getOrCreateHost,
  removeHost,
} from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import { adminTemplateApi } from '../../../api';
import {
  runValidationPipeline,
  type StepProgress,
  type ValidationStepContext,
} from './pipeline';
import { createNodepodValidationStep } from './nodepod-validation-step';

interface TemplateValidationPanelProps {
  templateId: string;
  onConfirmed: () => void;
}

const STATUS_ICON = {
  pending: null,
  running: Loader2,
  confirmed: CheckCircle2,
  failed: XCircle,
} as const;

export function TemplateValidationPanel({
  templateId,
  onConfirmed,
}: TemplateValidationPanelProps) {
  const { t } = useModuleTranslation('app-builder');
  const [steps, setSteps] = useState<StepProgress[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const disposeTransient = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    removeHost(sid);
    void conversationV2Api.deleteSession(sid).catch(() => undefined);
  }, []);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setError(null);
    setConfirmed(false);
    setPreviewUrl(null);
    setSessionId(null);

    const ctx: ValidationStepContext = {
      templateId,
      signal: controller.signal,
      setSessionId,
    };

    try {
      await runValidationPipeline([createNodepodValidationStep()], ctx, setSteps);
      await adminTemplateApi.validate(templateId);
      setConfirmed(true);
      setRunning(false);
      onConfirmed();
    } catch (err) {
      setRunning(false);
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [templateId, onConfirmed]);

  // Auto-start on mount; tear down the transient session on unmount.
  useEffect(() => {
    void run();
    return () => {
      abortRef.current?.abort();
      disposeTransient();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per panel mount
  }, []);

  // Mirror the host preview URL into the panel while the transient host lives.
  useEffect(() => {
    if (!sessionId) {
      setPreviewUrl(null);
      return;
    }
    const host = getOrCreateHost(sessionId);
    const sync = (state: { previewUrl: string | null }) => setPreviewUrl(state.previewUrl);
    sync(host.state);
    return host.subscribe(sync);
  }, [sessionId]);

  const iframeRef = useCallback((element: HTMLIFrameElement | null) => {
    if (!sessionId) return;
    const host = getOrCreateHost(sessionId);
    if (element) host.attachPreviewIframe(element);
    else host.detachPreviewIframe();
  }, [sessionId]);

  return (
    <div className='space-y-4 rounded-xl border border-border/70 bg-muted/15 p-4'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm font-semibold text-foreground'>{t('validation.title')}</p>
        {!running && (error || confirmed) ? (
          <Button type='button' variant='outline' size='sm' className='gap-1.5' onClick={() => void run()}>
            <RefreshCw className='size-3.5' aria-hidden />
            {t('validation.retry')}
          </Button>
        ) : null}
      </div>

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
                {Icon ? <Icon className={cn('size-4', step.status === 'running' && 'animate-spin')} aria-hidden /> : null}
              </span>
              <div className='min-w-0'>
                <p className='font-medium text-foreground'>{t(step.labelKey as Parameters<typeof t>[0])}</p>
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
        <p className='rounded-lg bg-ok-soft/60 px-3 py-2 text-sm text-ok'>{t('validation.confirmedHint')}</p>
      ) : null}

      {previewUrl ? (
        <div className='overflow-hidden rounded-lg border border-border/60 bg-background'>
          <iframe
            ref={iframeRef}
            title={t('validation.previewTitle')}
            src={previewUrl}
            className='h-[360px] w-full'
          />
        </div>
      ) : (
        <div className='flex h-[120px] items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground'>
          {running ? t('validation.preparing') : t('validation.noPreview')}
        </div>
      )}
    </div>
  );
}
