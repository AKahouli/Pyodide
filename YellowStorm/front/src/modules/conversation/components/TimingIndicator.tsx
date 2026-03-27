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

export const TimingIndicator = memo(function TimingIndicator({ timeToFirstChunk, timeToFirstToken, durationMs, inputTokens, outputTokens }: TimingIndicatorProps) {
  const { t } = useModuleTranslation('conversation');
  if (!timeToFirstChunk && !timeToFirstToken && !durationMs) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex items-center gap-1 text-xs text-muted-foreground cursor-default  px-1'>
            <span>{formatTimingMs(timeToFirstChunk)}</span>
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
          {(inputTokens != null || outputTokens != null) && (
            <>
              <div className='border-t border-border my-1' />
              <div className='text-xs font-medium mb-1'>{t('timing.tokenUsage')}</div>
              <div className='text-xs grid grid-cols-2 gap-x-3 gap-y-0.5'>
                <span className='text-muted-foreground'>{t('timing.inputTokens')}</span>
                <span>{inputTokens?.toLocaleString() ?? '—'}</span>
                <span className='text-muted-foreground'>{t('timing.outputTokens')}</span>
                <span>{outputTokens?.toLocaleString() ?? '—'}</span>
                {inputTokens != null && outputTokens != null && (
                  <>
                    <span className='text-muted-foreground'>{t('timing.totalTokens')}</span>
                    <span>{(inputTokens + outputTokens).toLocaleString()}</span>
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
