import { useState } from 'react';
import {
  ChevronsUpDownIcon,
  EyeIcon,
  HistoryIcon,
  Loader2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { formatFinalizedDate, resolveLatestFinalizedRevisionId } from '../../utils/finalized-versions';

/**
 * Compact version switcher for the RightPanel header.
 * Keeps the NodePod preview full-height; history opens on demand in a popover.
 */
export function VersionSwitcher() {
  const { t, language } = useConversationV2Translation();
  const [open, setOpen] = useState(false);
  const finalizedVersions = useConversationV2Store((s) => s.finalizedVersions);
  const previewRevisionId = useConversationV2Store((s) => s.previewRevisionId);
  const loadingFinalizedVersions = useConversationV2Store((s) => s.loadingFinalizedVersions);
  const previewFinalizedVersion = useConversationV2Store((s) => s.previewFinalizedVersion);

  const latestRevisionId = resolveLatestFinalizedRevisionId(finalizedVersions);
  const activeRevisionId = previewRevisionId ?? latestRevisionId;
  const activeLabel = activeRevisionId ?? '—';
  const isHistorical =
    !!previewRevisionId &&
    !!latestRevisionId &&
    previewRevisionId !== latestRevisionId;

  if (loadingFinalizedVersions && finalizedVersions.length === 0) {
    return (
      <Button
        type='button'
        variant='ghost'
        size='sm'
        disabled
        className='h-8 gap-1.5 px-2 text-xs text-muted-foreground'
        aria-label={t('versionHistory.loading')}
      >
        <Loader2Icon className='size-3.5 animate-spin' />
      </Button>
    );
  }

  if (finalizedVersions.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className={cn(
                  'h-8 max-w-[9.5rem] gap-1.5 px-2 text-xs font-medium',
                  '@max-[520px]/right-panel:max-w-none @max-[520px]/right-panel:px-1.5',
                  isHistorical && 'bg-primary/10 text-foreground',
                )}
                aria-label={t('versionHistory.open')}
              >
                <HistoryIcon className='size-3.5 shrink-0' />
                <span className='min-w-0 truncate font-mono @max-[520px]/right-panel:hidden'>{activeLabel}</span>
                <Badge
                  variant='secondary'
                  className='h-4 shrink-0 border-0 px-1 text-[10px] font-normal tabular-nums'
                >
                  {finalizedVersions.length}
                </Badge>
                <ChevronsUpDownIcon className='size-3 shrink-0 opacity-60 @max-[520px]/right-panel:hidden' />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side='bottom' className='text-xs'>
            {t('versionHistory.open')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent align='end' className='w-80 p-0' sideOffset={6}>
        <div className='border-b px-3 py-2'>
          <p className='text-xs font-medium text-foreground'>{t('versionHistory.title')}</p>
          <p className='text-[11px] text-muted-foreground'>{t('versionHistory.subtitle')}</p>
        </div>
        <ul className='max-h-64 space-y-0.5 overflow-y-auto p-1.5'>
          {finalizedVersions.map((version) => {
            const isActive = version.revisionId === activeRevisionId;
            const isLatest = version.revisionId === latestRevisionId;
            return (
              <li
                key={version.revisionId}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                  isActive && 'bg-primary/10',
                  !isActive && 'cursor-pointer hover:bg-muted/60',
                )}
                onClick={() => {
                  if (!isActive) {
                    previewFinalizedVersion(version.revisionId);
                    setOpen(false);
                  }
                }}
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <span className='font-mono font-medium'>{version.revisionId}</span>
                    {isLatest && (
                      <Badge variant='secondary' className='h-5 border-0 px-1.5 text-[10px] font-normal'>
                        {t('versionHistory.latest')}
                      </Badge>
                    )}
                    {isActive && (
                      <Badge variant='outline' className='h-5 px-1.5 text-[10px] font-normal'>
                        {t('versionHistory.active')}
                      </Badge>
                    )}
                  </div>
                  <p className='truncate text-[11px] text-muted-foreground'>
                    {formatFinalizedDate(version.finalizedAt, language)}
                    {version.title !== 'App' ? ` · ${version.title}` : ''}
                  </p>
                </div>
                {!isActive && (
                  <EyeIcon className='size-3.5 shrink-0 text-muted-foreground' />
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
