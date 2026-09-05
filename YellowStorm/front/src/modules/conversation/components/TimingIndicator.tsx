import { memo } from 'react';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { formatTimingMs } from '../utils';
import { useModuleTranslation } from '@/modules/localization';
import { conversationFeatures } from '../features';
import type { ConversationLatencyMetricsV1 } from '../types';

interface TimingIndicatorProps {
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMetrics?: ConversationLatencyMetricsV1;
}

function formatCompactTokens(value: number | undefined, language: string): string {
  if (value == null) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(language, { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString(language, { maximumFractionDigits: 1 })}k`;
  return value.toLocaleString(language);
}

/** <1000 ms as integer milliseconds, otherwise seconds with two decimals. */
function formatLatencyValue(value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** Exactly one row per required latency stage, in pipeline order. */
const LATENCY_ROWS = [
  { key: 'backendPreAdkMs', labelKey: 'latency.backendPreAdk' },
  { key: 'adkPreProviderMs', labelKey: 'latency.adkPreProvider' },
  { key: 'providerTtftMs', labelKey: 'latency.providerTtft' },
  { key: 'adkForwardingMs', labelKey: 'latency.adkForwarding' },
  { key: 'backendForwardingMs', labelKey: 'latency.backendForwarding' },
  { key: 'frontendRenderMs', labelKey: 'latency.frontendRender' },
] as const satisfies ReadonlyArray<{ key: keyof ConversationLatencyMetricsV1; labelKey: string }>;

function hasLatencyMetrics(metrics: ConversationLatencyMetricsV1 | undefined): boolean {
  if (!metrics) return false;
  return LATENCY_ROWS.some(({ key }) => metrics[key] !== undefined);
}

export const TimingIndicator = memo(function TimingIndicator({ timeToFirstChunk, timeToFirstToken, durationMs, inputTokens, outputTokens, latencyMetrics }: TimingIndicatorProps) {
  const { t, language } = useModuleTranslation('conversation');
  const hasTokenUsage = inputTokens != null || outputTokens != null;
  const showLatencyPopover = conversationFeatures.latencyUiEnabled && hasLatencyMetrics(latencyMetrics);
  if (!showLatencyPopover && !timeToFirstChunk && !timeToFirstToken && !durationMs && !hasTokenUsage) {
    return null;
  }

  const legacyStats = (
    <>
      <div className='border-t border-border my-1' />
      <div className='text-xs font-medium mb-1'>{t('timing.title')}</div>
      <div className='text-xs grid grid-cols-2 gap-x-3 gap-y-0.5'>
        <span className='text-muted-foreground'>{t('timing.firstChunk')}</span>
        <span>{formatTimingMs(timeToFirstChunk)}</span>
        <span className='text-muted-foreground'>{t('timing.firstToken')}</span>
        <span>{formatTimingMs(timeToFirstToken)}</span>
        <span className='text-muted-foreground'>{t('timing.response')}</span>
        <span>{formatTimingMs(durationMs)}</span>
      </div>
      {hasTokenUsage && (
        <>
          <div className='border-t border-border my-1' />
          <div className='text-xs font-medium mb-1'>{t('timing.tokenUsage')}</div>
          <div className='text-xs grid grid-cols-2 gap-x-3 gap-y-0.5'>
            <span className='text-muted-foreground'>{t('timing.inputTokens')}</span>
            <span>{inputTokens?.toLocaleString(language) ?? '—'}</span>
            <span className='text-muted-foreground'>{t('timing.outputTokens')}</span>
            <span>{outputTokens?.toLocaleString(language) ?? '—'}</span>
            {inputTokens != null && outputTokens != null && (
              <>
                <span className='text-muted-foreground'>{t('timing.totalTokens')}</span>
                <span>{(inputTokens + outputTokens).toLocaleString(language)}</span>
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  if (showLatencyPopover && latencyMetrics) {
    return (
      <Popover>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='size-11 md:size-7'
                aria-label={t('latency.openDetails')}
                data-response-latency
              >
                <Clock className='h-3.5 w-3.5' />
              </Button>
            </PopoverTrigger>
            <TooltipContent>{t('latency.openDetails')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverContent side='top' align='start' className='w-72'>
          <div className='text-xs font-medium mb-1'>{t('latency.title')}</div>
          <div className='text-xs grid grid-cols-2 gap-x-3 gap-y-0.5'>
            {LATENCY_ROWS.map(({ key, labelKey }) => (
              <div key={key} className='col-span-2 grid grid-cols-2 gap-x-3 gap-y-0.5'>
                <span className='text-muted-foreground'>{t(labelKey)}</span>
                <span>{formatLatencyValue(latencyMetrics[key] as number | undefined)}</span>
              </div>
            ))}
          </div>
          <div className='border-t border-border my-1' />
          <div className='text-xs text-muted-foreground'>
            {latencyMetrics.quality === 'clock-skew'
              ? t('latency.clockSkew')
              : latencyMetrics.quality === 'partial'
                ? t('latency.partial')
                : t('latency.qualityOk')}
          </div>
          {legacyStats}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground cursor-default'>
            <span>{formatTimingMs(timeToFirstChunk)}</span>
            {hasTokenUsage && (
              <span data-response-token-usage aria-label={`${t('timing.inputTokens')} ${inputTokens?.toLocaleString(language) ?? '-'}, ${t('timing.outputTokens')} ${outputTokens?.toLocaleString(language) ?? '-'}`}>
                {t('timing.compactTokens')}: {formatCompactTokens(inputTokens, language)}/{formatCompactTokens(outputTokens, language)}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side='top' className='space-y-1'>
          {legacyStats}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
