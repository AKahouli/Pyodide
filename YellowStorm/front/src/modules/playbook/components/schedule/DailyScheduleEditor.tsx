import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UpsertPlaybookScheduleData } from '../../types';
import type { ModuleTranslationKey } from '@/modules/localization/types';
import { timeLocalFromInput } from './timeInput';
import type { PlaybookScheduleT } from './scheduleTranslate';

interface Props {
  draft: UpsertPlaybookScheduleData;
  t: PlaybookScheduleT;
  setDraft: React.Dispatch<React.SetStateAction<UpsertPlaybookScheduleData>>;
}

export function DailyScheduleEditor({ draft, t, setDraft }: Props) {
  const times = draft.daily?.timesLocal ?? ['09:00'];

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm">
      <div>
        <div className="text-xs font-medium text-foreground">
          {t('schedule.dailyCardTitle' as ModuleTranslationKey<'playbook'>)}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">
          {t('schedule.dailyHint' as ModuleTranslationKey<'playbook'>)}
        </p>
      </div>
      <div className="space-y-3">
        {times.map((time, i) => {
          const canRemoveTime = times.length > 1;
          return (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-md border border-border/80 bg-background/60 p-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label className="text-xs" htmlFor={`daily-time-${i}`}>
                  {t('schedule.dailyTimeLabel' as ModuleTranslationKey<'playbook'>, { n: i + 1 })}
                </Label>
                <Input
                  id={`daily-time-${i}`}
                  type="time"
                  step={60}
                  className="bg-background w-full min-h-10 sm:max-w-[12rem]"
                  value={timeLocalFromInput(time) || '09:00'}
                  onChange={(e) => {
                    const updated = [...times];
                    updated[i] = timeLocalFromInput(e.target.value) || '09:00';
                    setDraft((d) => ({ ...d, daily: { timesLocal: updated } }));
                  }}
                />
              </div>
              {canRemoveTime ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 h-9 px-2.5 sm:self-end"
                  aria-label={t('schedule.removeTimeAria' as ModuleTranslationKey<'playbook'>)}
                  onClick={() => {
                    const updated = times.filter((_, j) => j !== i);
                    setDraft((d) => ({ ...d, daily: { timesLocal: updated.length ? updated : ['09:00'] } }));
                  }}
                >
                  <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{t('schedule.removeTime')}</span>
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full sm:w-auto"
        onClick={() =>
          setDraft((d) => ({
            ...d,
            daily: { timesLocal: [...(d.daily?.timesLocal ?? []), '12:00'] },
          }))
        }
      >
        {t('schedule.addTime')}
      </Button>
    </div>
  );
}
