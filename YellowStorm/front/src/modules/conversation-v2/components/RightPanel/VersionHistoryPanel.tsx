import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  formatFinalizedDate,
  resolveFinalizedVersionNumber,
  resolveLatestFinalizedRevisionId,
} from '../../utils/finalized-versions';

/**
 * Compact version switcher for the RightPanel header.
 * Keeps the NodePod preview full-height; history opens on demand in a popover.
 *
 * While the agent is streaming, the upcoming version is shown as an amber
 * "Draft" row (with its current workspace revision reference). It becomes a
 * definitive "Version N" entry only once the finalizer step lands and the
 * finalized version is recorded — every row keeps its rev_id in the background.
 */
export function VersionSwitcher() {
  const { t, language } = useConversationV2Translation();
  const [open, setOpen] = useState(false);
  const finalizedVersions = useConversationV2Store((s) => s.finalizedVersions);
  const previewRevisionId = useConversationV2Store((s) => s.previewRevisionId);
  const loadingFinalizedVersions = useConversationV2Store((s) => s.loadingFinalizedVersions);
  const previewFinalizedVersion = useConversationV2Store((s) => s.previewFinalizedVersion);
  const streaming = useConversationV2Store((s) => s.streaming);
  const events = useConversationV2Store((s) => s.events);
  const hasAppTrack = useConversationV2Store(
    (s) => !!s.applicationComponent || !!s.appBuildProgress,
  );
  const latestRevisionId = resolveLatestFinalizedRevisionId(finalizedVersions);
  const activeRevisionId = previewRevisionId ?? latestRevisionId;
  const activeVersionNumber = resolveFinalizedVersionNumber(finalizedVersions, activeRevisionId);
  const activeLabel = activeVersionNumber != null
    ? t('versionHistory.version', { number: activeVersionNumber })
    : activeRevisionId ?? '—';
  const isHistorical =
    !!previewRevisionId &&
    !!latestRevisionId &&
    previewRevisionId !== latestRevisionId;

  // The current turn's first user message marks when the upcoming version
  // started being built.
  const turnStartSeconds = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === 'message' && (event as { role?: string }).role === 'user') {
        return event.timestamp;
      }
    }
    return null;
  }, [events]);

  const draftPending =
    streaming &&
    hasAppTrack &&
    turnStartSeconds != null &&
    !finalizedVersions.some((v) => Date.parse(v.finalizedAt) > turnStartSeconds * 1000);
  const draftVersionNumber = finalizedVersions.length + 1;

  // Make the draft immediately visible: auto-open the history when the draft
  // appears and close it once the finalizer step converts it to a definitive
  // version. A manual close while streaming is respected (the effect only
  // reacts to draftPending transitions).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (draftPending) {
      if (!autoOpenedRef.current) {
        autoOpenedRef.current = true;
        setOpen(true);
      }
    } else if (autoOpenedRef.current) {
      autoOpenedRef.current = false;
      setOpen(false);
    }
  }, [draftPending]);

  if (loadingFinalizedVersions && finalizedVersions.length === 0 && !draftPending) {
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

  if (finalizedVersions.length === 0 && !draftPending) {
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
                  isHistorical && 'bg-primary/10 text-foreground',
                )}
                aria-label={t('versionHistory.open')}
              >
                <HistoryIcon className='size-3.5 shrink-0' />
                <span className='min-w-0 truncate'>{activeLabel}</span>
                <Badge
                  variant='secondary'
                  className='h-4 shrink-0 border-0 px-1 text-[10px] font-normal tabular-nums'
                >
                  {finalizedVersions.length}
                </Badge>
                <ChevronsUpDownIcon className='size-3 shrink-0 opacity-60' />
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
          {draftPending && (
            <li
              className='flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs'
              data-testid='version-draft-row'
            >
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <span className='font-medium'>
                    {t('versionHistory.version', { number: draftVersionNumber })}
                  </span>
                  <Badge
                    variant='outline'
                    className='h-5 shrink-0 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400'
                  >
                    {t('versionHistory.draft')}
                  </Badge>
                </div>
                <p className='truncate text-[11px] text-muted-foreground'>
                  {t('versionHistory.building')}
                </p>
              </div>
              <Loader2Icon className='size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400' />
            </li>
          )}
          {finalizedVersions.map((version) => {
            const isActive = version.revisionId === activeRevisionId;
            const isLatest = version.revisionId === latestRevisionId;
            const versionNumber = resolveFinalizedVersionNumber(finalizedVersions, version.revisionId);
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
                    <span className='font-medium'>
                      {versionNumber != null
                        ? t('versionHistory.version', { number: versionNumber })
                        : version.revisionId}
                    </span>
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
