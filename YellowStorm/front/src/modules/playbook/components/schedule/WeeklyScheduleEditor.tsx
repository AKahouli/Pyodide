import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UpsertPlaybookScheduleData } from '../../types';
import type { ModuleTranslationKey } from '@/modules/localization/types';
import { timeLocalFromInput } from './timeInput';
import type { PlaybookScheduleT } from './scheduleTranslate';

interface Props {
  draft: UpsertPlaybookScheduleData;
  t: PlaybookScheduleT;
  setDraft: React.Dispatch<React.SetStateAction<UpsertPlaybookScheduleData>>;
}

export function WeeklyScheduleEditor({ draft, t, setDraft }: Props) {
  const slots = draft.weekly?.slots ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t('schedule.weeklyExplainer' as ModuleTranslationKey<'playbook'>)}
      </p>
      {slots.map((slot, i) => {
        const canRemoveSlot = slots.length > 1;
        return (
          <div
            key={i}
            className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm"
          >
            <div
              className={cn(
                'flex items-center gap-2',
                canRemoveSlot ? 'justify-between' : 'justify-start',
              )}
            >
              <span className="text-xs font-medium text-foreground">
                {t('schedule.weeklySlotLabel' as ModuleTranslationKey<'playbook'>, { n: i + 1 })}
              </span>
              {canRemoveSlot ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 h-9 px-2.5"
                  aria-label={t('schedule.removeWeeklySlotAria' as ModuleTranslationKey<'playbook'>)}
                  onClick={() => {
                    const updated = slots.filter((_, j) => j !== i);
                    setDraft((d) => ({
                      ...d,
                      weekly: { slots: updated.length ? updated : [{ weekday: 1, timeLocal: '09:00' }] },
                    }));
                  }}
                >
                  <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{t('schedule.removeSlot')}</span>
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs" htmlFor={`weekly-wd-${i}`}>
                  {t('schedule.weekday')}
                </Label>
                <Select
                  value={String(slot.weekday)}
                  onValueChange={(v) => {
                    const updated = [...slots];
                    updated[i] = { ...updated[i], weekday: Number(v) };
                    setDraft((d) => ({ ...d, weekly: { slots: updated } }));
                  }}
                >
                  <SelectTrigger id={`weekly-wd-${i}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4, 5, 6].map((wd) => (
                      <SelectItem key={wd} value={String(wd)}>
                        {t(`schedule.weekdays.${wd}` as ModuleTranslationKey<'playbook'>)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs" htmlFor={`weekly-time-${i}`}>
                  {t('schedule.time')}
                </Label>
                <Input
                  id={`weekly-time-${i}`}
                  type="time"
                  step={60}
                  className="bg-background w-full min-h-10"
                  value={timeLocalFromInput(slot.timeLocal) || '09:00'}
                  onChange={(e) => {
                    const updated = [...slots];
                    updated[i] = {
                      ...updated[i],
                      timeLocal: timeLocalFromInput(e.target.value) || '09:00',
                    };
                    setDraft((d) => ({ ...d, weekly: { slots: updated } }));
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full sm:w-auto"
        onClick={() =>
          setDraft((d) => ({
            ...d,
            weekly: {
              slots: [...(d.weekly?.slots ?? []), { weekday: 1, timeLocal: '09:00' }],
            },
          }))
        }
      >
        {t('schedule.addSlot')}
      </Button>
    </div>
  );
}
