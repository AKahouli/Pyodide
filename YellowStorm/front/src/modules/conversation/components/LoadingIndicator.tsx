import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Sparkles, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useModuleTranslation } from '@/modules/localization';
import type { ConversationStreamActivity } from '../utils';
import type { MessageComponent } from '../types';

type StreamDetail =
  | { type: 'thought'; label: string }
  | { type: 'tool'; occurrenceId: string; title: string; status: 'running' | 'completed' | 'failed'; data: Record<string, unknown>; startedAt?: string; sequence: number; durationSeconds?: number };

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDebugData(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, null, 2) || '{}';
  } catch {
    return String(data);
  }
}

function formatToolDate(value: string | undefined, locale: string): { label: string; tooltip: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    label: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date),
    tooltip: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long' }).format(date),
  };
}

function getStreamDetails(components: readonly MessageComponent[]): StreamDetail[] {
  const toolNames = new Set(
    components
      .filter((component) => component.type === 'toolInfo' && typeof component.data.title === 'string')
      .map((component) => component.data.title as string),
  );

  const details = components.flatMap<StreamDetail>((component, componentIndex): StreamDetail[] => {
    if (component.type === 'chainOfThought') {
      const steps = component.data.steps;
      return Array.isArray(steps)
        ? steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0 && !toolNames.has(step)).map((label) => ({ type: 'thought' as const, label }))
        : [];
    }

    if (component.type === 'toolInfo') {
      const title = typeof component.data.title === 'string' ? component.data.title : '';
      const status = component.data.status;
      return [{
        type: 'tool' as const,
        occurrenceId: component.id || `legacy-tool-${componentIndex}`,
        title: formatLabel(title),
        status: status === 'completed' || status === 'failed' ? status : 'running',
        data: Object.fromEntries(Object.entries(component.data).filter(([key]) => key !== 'resultJson' && key !== 'result_json')),
        startedAt: typeof component.data.startedAt === 'string' ? component.data.startedAt : undefined,
        sequence: 0,
      }];
    }

    return [];
  });

  const tools = details.filter((detail): detail is Extract<StreamDetail, { type: 'tool' }> => detail.type === 'tool');
  tools.forEach((tool, index) => {
    tool.sequence = index + 1;
    const startedAt = tool.startedAt ? Date.parse(tool.startedAt) : Number.NaN;
    const nextStartedAtValue = tools[index + 1]?.startedAt;
    const nextStartedAt = nextStartedAtValue ? Date.parse(nextStartedAtValue) : Number.NaN;
    if (Number.isFinite(startedAt) && Number.isFinite(nextStartedAt) && nextStartedAt >= startedAt) {
      tool.durationSeconds = Math.round((nextStartedAt - startedAt) / 1000);
    }
  });

  return details;
}

export function LoadingIndicator({ activity = 'thinking', components = [], isComplete = false }: Readonly<{ activity?: ConversationStreamActivity; components?: readonly MessageComponent[]; isComplete?: boolean }>) {
  const { t, language } = useModuleTranslation('conversation');
  const [isOpen, setIsOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const details = useMemo(() => getStreamDetails(components), [components]);
  const labels: Record<ConversationStreamActivity, string> = {
    thinking: t('stream.activity.thinking'),
    usingTools: t('stream.activity.usingTools'),
    responding: t('stream.activity.responding'),
  };
  const toolStatusLabels: Record<'running' | 'completed' | 'failed', string> = {
    running: t('stream.activity.toolStatus.running'),
    completed: t('stream.activity.toolStatus.completed'),
    failed: t('stream.activity.toolStatus.failed'),
  };

  useEffect(() => {
    if (isComplete) return;
    const timer = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isComplete]);

  if (isComplete && details.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='w-full max-w-2xl rounded-2xl rounded-tl-sm border border-border/70 bg-muted/35 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75'>
      <div className='flex min-w-0 items-center gap-3 px-1'>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          <span className='absolute inset-1 rounded-full bg-primary/20 ring-1 ring-primary/40' />
          {isComplete ? (
            <Sparkles className='size-4 text-primary' />
          ) : (
            <Loader2 className='size-5 animate-spin text-primary [animation-duration:1.1s] motion-reduce:animate-none' />
          )}
        </span>
        <div className='min-w-0 flex-1'>
          {isComplete ? (
            <>
              <p className='truncate text-sm font-medium text-foreground'>{t('stream.activity.completed')}</p>
              <p className='text-xs text-muted-foreground'>{t('stream.activity.completedDescription')}</p>
            </>
          ) : (
            <>
              <div role='status' aria-live='polite' aria-atomic='true'>
                <p className='truncate text-sm font-medium text-foreground'>{labels[activity]}</p>
              </div>
              <p className='text-xs text-muted-foreground' aria-hidden='true'>{t('stream.activity.elapsed', { seconds: elapsedSeconds })}</p>
            </>
          )}
        </div>
        {details.length > 0 && (
            <CollapsibleTrigger className='inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted' aria-label={t('stream.activity.detailsAria')}>
              {t('stream.activity.details', { count: details.length })}
              <ChevronDown className='size-3.5 transition-transform data-[state=open]:rotate-180' />
            </CollapsibleTrigger>
        )}
      </div>
      {details.length > 0 && (
        <CollapsibleContent className='pt-3'>
          <div className='max-h-48 space-y-3 overflow-auto border-t pt-3 pr-1'>
            {details.map((detail, index) => {
              if (detail.type === 'thought') {
                return (
                  <div key={`thought-${index}`} className='flex gap-2 text-sm text-muted-foreground'>
                    <span className='mt-2 size-1.5 shrink-0 rounded-full bg-primary/70' aria-hidden='true' />
                    <span className='break-words'>{detail.label}</span>
                  </div>
                );
              }

              const toolDate = formatToolDate(detail.startedAt, language);
              const toolTitle = detail.title || t('stream.activity.toolFallback');
              return (
                <details key={detail.occurrenceId} className='rounded-lg bg-muted/60 p-2.5'>
                  <summary className='flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden'>
                    <Wrench className='size-3.5 text-primary' aria-hidden='true' />
                    <span className='min-w-0 flex-1 break-words'>{detail.sequence}. {toolTitle}</span>
                    {detail.durationSeconds !== undefined && (
                      <span data-duration-seconds={detail.durationSeconds} className='text-xs font-normal tabular-nums text-muted-foreground'>{t('stream.activity.toolDuration', { seconds: detail.durationSeconds })}</span>
                    )}
                    <span className='text-xs font-normal text-muted-foreground'>{toolStatusLabels[detail.status]}</span>
                  </summary>
                  <div className='mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
                    <span>{t('stream.activity.debugData')}</span>
                    {toolDate && <span className='truncate' title={toolDate.tooltip}>· {toolDate.label}</span>}
                  </div>
                  <pre className='mt-2 max-h-40 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words'>{formatDebugData(detail.data)}</pre>
                </details>
              );
            })}
            <p className='text-xs text-muted-foreground'>{t('stream.activity.sensitiveNotice')}</p>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export function StreamingCursor() {
  return <span className='inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-pulse' />;
}
