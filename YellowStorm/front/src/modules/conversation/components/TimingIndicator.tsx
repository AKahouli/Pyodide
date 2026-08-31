import { memo } from 'react';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTimingMs } from '../utils';
import { useModuleTranslation } from '@/modules/localization';

interface TimingIndicatorProps {
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function formatCompactTokens(value: number | undefined, language: string): string {
  if (value == null) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(language, { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString(language, { maximumFractionDigits: 1 })}k`;
  return value.toLocaleString(language);
}

export const TimingIndicator = memo(function TimingIndicator({ timeToFirstChunk, timeToFirstToken, durationMs, inputTokens, outputTokens }: TimingIndicatorProps) {
  const { t, language } = useModuleTranslation('conversation');
  const hasTokenUsage = inputTokens != null || outputTokens != null;
  if (!timeToFirstChunk && !timeToFirstToken && !durationMs && !hasTokenUsage) {
    return null;
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
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
