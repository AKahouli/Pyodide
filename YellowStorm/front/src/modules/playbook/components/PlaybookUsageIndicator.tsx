import { Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUsage } from '@/modules/usage';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';

function formatTokenCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function getBarColor(percent: number): string {
  if (percent >= 90) return 'bg-rose-500';
  if (percent >= 70) return 'bg-amber-500';
  if (percent >= 50) return 'bg-yellow-400';
  return 'bg-green-400';
}

function formatTimeRemaining(resetsAt: string): string {
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return '—';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function PlaybookUsageIndicator() {
  const { status } = useUsage();
  const { t } = useModuleTranslation('playbook');

  if (!status) return null;

  const { tokens } = status;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs text-muted-foreground cursor-default shrink-0">
            <Zap className="h-3 w-3" />
            <span className="font-medium">
              {tokens.isUnlimited
                ? t('usage.tokensUnlimited')
                : `${formatTokenCount(tokens.total)} / ${formatTokenCount(tokens.limit)}`}
            </span>
            {!tokens.isUnlimited && (
              <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', getBarColor(tokens.percentUsed))}
                  style={{ width: `${Math.min(tokens.percentUsed, 100)}%` }}
                />
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs space-y-1">
          <p>{t('usage.input')}: {formatTokenCount(tokens.input)}</p>
          <p>{t('usage.output')}: {formatTokenCount(tokens.output)}</p>
          {!tokens.isUnlimited && (
            <p>{t('usage.resetsIn')}: {formatTimeRemaining(status.resetsAt)}</p>
          )}
          {status.isLimitExceeded && (
            <p className="text-rose-500 font-medium">{t('usage.limitExceeded')}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
