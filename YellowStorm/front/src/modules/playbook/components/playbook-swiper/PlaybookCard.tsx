import { Clock, ListChecks, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { formatFullDateLabel, formatRelativeTimeLabel } from '@/utils/date';
import { getInitials } from '@/utils/string';
import type { PlaybookSummary } from '@/modules/playbook/types';

type PlaybookCardProps = Readonly<{
  playbook: PlaybookSummary;
  accentClass: string;
  isVisible: boolean;
  onClick?: () => void;
}>;

export function PlaybookCard({ playbook, accentClass, isVisible, onClick }: PlaybookCardProps) {
  const { t, language } = useModuleTranslation('playbook');
  const lastExecutionLabel = formatRelativeTimeLabel(playbook.lastExecutionAt, t('dates.neverRun'), language);
  const createdAtLabel = formatFullDateLabel(playbook.createdAt, t('dates.unknown'), language);

  return (
    <button type='button' onClick={onClick} className={cn('flex h-full w-full flex-col gap-4 rounded-2xl border bg-card/80 p-4 text-left shadow-sm transition-all duration-300', 'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl', isVisible ? 'opacity-100' : 'opacity-70')} aria-label={t('swiper.card.openAria', { name: playbook.name })}>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-1 items-center gap-3'>
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br text-sm font-semibold uppercase shadow-inner', accentClass)}>{getInitials(playbook.name)}</div>
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm font-semibold' title={playbook.name}>{playbook.name}</p>
            <p className='truncate text-xs text-muted-foreground'>{createdAtLabel}</p>
          </div>
        </div>
        {playbook.isFavorite && <Star className='h-4 w-4 text-yellow-500' />}
      </div>

      <p className='line-clamp-2 min-h-10 text-sm text-muted-foreground'>{playbook.description}</p>

      <div className='mt-1 flex gap-3 text-xs text-muted-foreground'>
        <div className='flex w-[110px] shrink-0 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2'>
          <ListChecks className='h-4 w-4 text-foreground/80' />
          <div>
            <p className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70'>{t('swiper.card.stepsLabel')}</p>
            <p className='text-[11px] font-semibold text-foreground'>
              {playbook.taskCount} {t('swiper.card.stepsUnit', { count: playbook.taskCount })}
            </p>
          </div>
        </div>

        <div className='flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2'>
          <Clock className='h-4 w-4 text-foreground/80' />
          <div className='flex w-full flex-col overflow-hidden text-foreground'>
            <p className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70'>{t('swiper.card.lastRunLabel')}</p>
            <p className='truncate whitespace-nowrap text-[11px] font-semibold' title={lastExecutionLabel}>
              {lastExecutionLabel}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}
