import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Search, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useModuleTranslation } from '@/modules/localization';
import type { ConversationStreamActivity } from '../utils';
import type { MessageComponent } from '../types';

type StreamDetail =
  | { type: 'thought'; label: string }
  | { type: 'tool'; title: string; status: 'running' | 'completed' | 'failed'; data: Record<string, unknown>; startedAt?: string; resultJson?: string; sequence: number; durationSeconds?: number };

type SelectedResponse = { title: string; resultJson: string };

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

function formatToolResponse(resultJson: string): string {
  try {
    return JSON.stringify(JSON.parse(resultJson), null, 2);
  } catch {
    return resultJson;
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

  const details = components.flatMap<StreamDetail>((component): StreamDetail[] => {
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
        title: formatLabel(title),
        status: status === 'completed' || status === 'failed' ? status : 'running',
        data: component.data,
        startedAt: typeof component.data.startedAt === 'string' ? component.data.startedAt : undefined,
        resultJson: typeof component.data.resultJson === 'string' && component.data.resultJson.length > 0 ? component.data.resultJson : undefined,
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
  const [selectedResponse, setSelectedResponse] = useState<SelectedResponse | null>(null);
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
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='mx-2 mb-2 shrink-0 rounded-xl border border-border/80 bg-background/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 md:mx-4'>
      <div className='flex min-w-0 items-center gap-3 px-1'>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          <span className='absolute inset-1 rounded-full bg-primary/20 ring-1 ring-primary/40' />
          {isComplete ? (
            <Sparkles className='size-4 text-primary' />
          ) : (
            <Loader2 className='size-5 animate-spin text-primary [animation-duration:1.1s]' />
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
              const resultJson = detail.resultJson;
              return (
                <details key={`tool-${index}`} className='rounded-lg bg-muted/60 p-2.5'>
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
                    {resultJson && (
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type='button' variant='ghost' size='icon-sm' className='ml-auto size-7 shrink-0' aria-label={t('stream.activity.viewResponse')} onClick={() => setSelectedResponse({ title: toolTitle, resultJson })}>
                              <Search aria-hidden='true' />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('stream.activity.viewResponse')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <pre className='mt-2 max-h-40 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words'>{formatDebugData(detail.data)}</pre>
                </details>
              );
            })}
            <p className='text-xs text-muted-foreground'>{t('stream.activity.sensitiveNotice')}</p>
          </div>
        </CollapsibleContent>
      )}
      <Dialog open={selectedResponse !== null} onOpenChange={(open) => { if (!open) setSelectedResponse(null); }}>
        <DialogContent className='flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden'>
          <DialogHeader>
            <DialogTitle>{t('stream.activity.responseTitle', { tool: selectedResponse?.title || t('stream.activity.toolFallback') })}</DialogTitle>
            <DialogDescription>{t('stream.activity.responseDescription')}</DialogDescription>
          </DialogHeader>
          <pre className='min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words'>{selectedResponse ? formatToolResponse(selectedResponse.resultJson) : ''}</pre>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

export function StreamingCursor() {
  return <span className='inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-pulse' />;
}
