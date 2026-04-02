import { CalendarCheck2, CalendarOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import type { ExecutionScheduleData, UpsertPlaybookScheduleData } from '../../types';
import { fromExecutionSchedule, defaultSchedule } from './helpers';
import type { PlaybookScheduleT } from './scheduleTranslate';

interface Props {
  draft: UpsertPlaybookScheduleData;
  schedule: ExecutionScheduleData | null;
  t: PlaybookScheduleT;
  setDraft: React.Dispatch<React.SetStateAction<UpsertPlaybookScheduleData>>;
}

export function ScheduleActiveToggle({ draft, schedule, t, setDraft }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-base font-semibold">{t('schedule.stateLabel')}</Label>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-[280px]">
            {draft.enabled
              ? t('schedule.stateActiveHint')
              : t('schedule.stateInactiveHint')}
          </p>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted/70 border border-border/80 shadow-inner"
        role="tablist"
        aria-label={t('schedule.stateLabel')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={draft.enabled}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
            draft.enabled
              ? 'bg-background text-foreground shadow-sm border border-border/50'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
          )}
          onClick={() =>
            setDraft(
              schedule?.enabled && schedule.type ? fromExecutionSchedule(schedule) : defaultSchedule(),
            )
          }
        >
          <CalendarCheck2
            className={cn('h-4 w-4 shrink-0', draft.enabled ? 'text-emerald-600 dark:text-emerald-400' : '')}
            aria-hidden
          />
          <span>{t('schedule.stateActive')}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!draft.enabled}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
            !draft.enabled
              ? 'bg-background text-foreground shadow-sm border border-border/50'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
          )}
          onClick={() => setDraft({ enabled: false })}
        >
          <CalendarOff
            className={cn('h-4 w-4 shrink-0', !draft.enabled ? 'text-amber-600/90 dark:text-amber-400/90' : '')}
            aria-hidden
          />
          <span>{t('schedule.stateInactive')}</span>
        </button>
      </div>
    </div>
  );
}
