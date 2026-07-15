import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Sparkles, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useModuleTranslation } from '@/modules/localization';
import type { ConversationStreamActivity } from '../utils';
import type { MessageComponent } from '../types';

type StreamDetail =
  | { type: 'thought'; label: string }
  | { type: 'tool'; title: string; status: 'running' | 'completed' | 'failed'; params?: string };

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatParameters(params: string): string {
  try {
    return JSON.stringify(JSON.parse(params), null, 2);
  } catch {
    return params;
  }
}

function getStreamDetails(components: readonly MessageComponent[]): StreamDetail[] {
  return components.flatMap<StreamDetail>((component): StreamDetail[] => {
    if (component.type === 'chainOfThought') {
      const steps = component.data.steps;
      return Array.isArray(steps)
        ? steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0).map((label) => ({ type: 'thought' as const, label }))
        : [];
    }

    if (component.type === 'toolInfo') {
      const title = typeof component.data.title === 'string' ? component.data.title : '';
      const status = component.data.status;
      return [{
        type: 'tool' as const,
        title: formatLabel(title),
        status: status === 'completed' || status === 'failed' ? status : 'running',
        ...(typeof component.data.params === 'string' && component.data.params.trim() ? { params: component.data.params } : {}),
      }];
    }

    return [];
  });
}

export function LoadingIndicator({ activity = 'thinking', components = [] }: Readonly<{ activity?: ConversationStreamActivity; components?: readonly MessageComponent[] }>) {
  const { t } = useModuleTranslation('conversation');
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
    const timer = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='mx-2 mb-2 shrink-0 rounded-xl border border-border/80 bg-background/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 md:mx-4'>
      <div className='flex min-w-0 items-center gap-3 px-1'>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          <span className='absolute inset-0 animate-ping rounded-full bg-primary/25 motion-reduce:animate-none' />
          <span className='absolute inset-1 rounded-full bg-primary/20 ring-1 ring-primary/40' />
          <Sparkles className='size-4 animate-pulse text-primary motion-reduce:animate-none' />
        </span>
        <div className='min-w-0 flex-1'>
          <div role='status' aria-live='polite' aria-atomic='true'>
            <p className='truncate text-sm font-medium text-foreground'>{labels[activity]}</p>
          </div>
          <p className='text-xs text-muted-foreground' aria-hidden='true'>{t('stream.activity.elapsed', { seconds: elapsedSeconds })}</p>
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
            {details.map((detail, index) => detail.type === 'thought' ? (
              <div key={`thought-${index}`} className='flex gap-2 text-sm text-muted-foreground'>
                <span className='mt-2 size-1.5 shrink-0 rounded-full bg-primary/70' aria-hidden='true' />
                <span className='break-words'>{detail.label}</span>
              </div>
            ) : (
              <div key={`tool-${index}`} className='rounded-lg bg-muted/60 p-2.5'>
                <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
                  <Wrench className='size-3.5 text-primary' aria-hidden='true' />
                  <span className='min-w-0 flex-1 break-words'>{detail.title || t('stream.activity.toolFallback')}</span>
                  <span className='text-xs font-normal text-muted-foreground'>{toolStatusLabels[detail.status]}</span>
                </div>
                {detail.params && (
                  <details className='mt-2 text-xs'>
                    <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>{t('stream.activity.parameters')}</summary>
                    <pre className='mt-2 max-h-32 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words'>{formatParameters(detail.params)}</pre>
                  </details>
                )}
              </div>
            ))}
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
