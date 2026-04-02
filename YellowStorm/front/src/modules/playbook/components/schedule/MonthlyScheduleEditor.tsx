import { useMemo } from 'react';
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
import { formatNextMonthlyOccurrencePreview } from '../../utils/scheduleDisplay';
import { clampMonthlyDay, maxDayForMonthlySlot } from '../../utils/monthlyCalendar';
import { timeLocalFromInput } from './timeInput';
import type { PlaybookScheduleT } from './scheduleTranslate';

type MonthlySlotShape = { monthOfYear?: number | null; dayOfMonth: number; timeLocal: string };

interface Props {
  draft: UpsertPlaybookScheduleData;
  t: PlaybookScheduleT;
  setDraft: React.Dispatch<React.SetStateAction<UpsertPlaybookScheduleData>>;
  language: string;
}

export function MonthlyScheduleEditor({ draft, t, setDraft, language }: Props) {
  const slots = draft.monthly?.slots ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground leading-relaxed">{t('schedule.monthlyRepeatExplainer')}</p>
      {slots.map((slot, i) => (
        <MonthlySlotEditor
          key={i}
          index={i}
          slot={slot}
          canRemove={slots.length > 1}
          t={t}
          language={language}
          setDraft={setDraft}
        />
      ))}
      <p className="text-xs text-muted-foreground">{t('schedule.monthlyHint')}</p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          setDraft((d) => ({
            ...d,
            monthly: {
              slots: [
                ...(d.monthly?.slots ?? []),
                { monthOfYear: 1, dayOfMonth: 1, timeLocal: '09:00' },
              ],
            },
          }))
        }
      >
        {t('schedule.addSlot')}
      </Button>
    </div>
  );
}

function MonthlySlotEditor({
  index,
  slot,
  canRemove,
  t,
  language,
  setDraft,
}: {
  index: number;
  slot: MonthlySlotShape;
  canRemove: boolean;
  t: PlaybookScheduleT;
  language: string;
  setDraft: React.Dispatch<React.SetStateAction<UpsertPlaybookScheduleData>>;
}) {
  const year = new Date().getFullYear();
  const maxDay = maxDayForMonthlySlot(slot.monthOfYear, year);
  const dayClamped = clampMonthlyDay(slot.dayOfMonth, slot.monthOfYear, year);

  const preview = useMemo(
    () => formatNextMonthlyOccurrencePreview(dayClamped, slot.timeLocal, language, slot.monthOfYear ?? null),
    [dayClamped, slot.timeLocal, language, slot.monthOfYear],
  );

  const daySelectValue =
    slot.dayOfMonth === -1
      ? '-1'
      : slot.dayOfMonth === 0
        ? '0'
        : String(dayClamped);

  const updateSlot = (updater: (s: MonthlySlotShape) => MonthlySlotShape) => {
    setDraft((d) => {
      const slots = [...(d.monthly?.slots ?? [])];
      slots[index] = updater(slots[index]);
      return { ...d, monthly: { slots } };
    });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm">
      <div
        className={cn(
          'flex items-center gap-2',
          canRemove ? 'justify-between' : 'justify-start',
        )}
      >
        <span className="text-xs font-medium text-foreground">
          {t('schedule.monthlySlotLabel' as ModuleTranslationKey<'playbook'>, { n: index + 1 })}
        </span>
        {canRemove ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 h-9 px-2.5"
            aria-label={t('schedule.removeSlotAria')}
            onClick={() => {
              setDraft((d) => {
                const slots = [...(d.monthly?.slots ?? [])].filter((_, j) => j !== index);
                return {
                  ...d,
                  monthly: {
                    slots: slots.length
                      ? slots
                      : [{ monthOfYear: 1, dayOfMonth: 1, timeLocal: '09:00' }],
                  },
                };
              });
            }}
          >
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t('schedule.removeSlot')}</span>
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">{t('schedule.month')}</Label>
          <Select
            value={slot.monthOfYear == null ? 'all' : String(slot.monthOfYear)}
            onValueChange={(v) => {
              const newMonth = v === 'all' ? null : Number(v);
              updateSlot((s) => ({
                ...s,
                monthOfYear: newMonth,
                dayOfMonth: clampMonthlyDay(s.dayOfMonth, newMonth, new Date().getFullYear()),
              }));
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('schedule.monthEvery')}</SelectItem>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {t(`schedule.months.${m}` as ModuleTranslationKey<'playbook'>)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">{t('schedule.dayOfMonth')}</Label>
          <Select
            key={`day-${index}-${slot.monthOfYear ?? 'all'}-${maxDay}`}
            value={daySelectValue}
            onValueChange={(v) => {
              const y = new Date().getFullYear();
              const next =
                v === '-1'
                  ? -1
                  : v === '0'
                    ? 0
                    : clampMonthlyDay(Number(v), slot.monthOfYear, y);
              updateSlot((s) => ({ ...s, dayOfMonth: next }));
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('schedule.dayOfMonth')} />
            </SelectTrigger>
            <SelectContent className="max-h-[min(100vh-8rem,280px)]">
              <SelectItem value="-1">{t('schedule.dayLastOfMonth')}</SelectItem>
              <SelectItem value="0">{t('schedule.everyDayOfMonth')}</SelectItem>
              {Array.from({ length: maxDay }, (_, j) => j + 1).map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">{t('schedule.time')}</Label>
          <Input
            type="time"
            step={60}
            className="bg-background w-full min-h-10"
            value={timeLocalFromInput(slot.timeLocal) || '09:00'}
            onChange={(e) => {
              updateSlot((s) => ({
                ...s,
                timeLocal: timeLocalFromInput(e.target.value) || '09:00',
              }));
            }}
          />
        </div>
      </div>
      {preview ? (
        <p className="text-xs text-muted-foreground pl-0.5">
          {t('schedule.monthlyNextExample' as ModuleTranslationKey<'playbook'>, { date: preview })}
        </p>
      ) : null}
    </div>
  );
}
