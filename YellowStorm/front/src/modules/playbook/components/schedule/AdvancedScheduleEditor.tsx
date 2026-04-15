import { RotateCcw } from 'lucide-react';
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

const WEEKDAY_BUSINESS_INDICES = [1, 2, 3, 4, 5] as const;

interface Props {
  draft: UpsertPlaybookScheduleData;
  t: PlaybookScheduleT;
  setDraft: React.Dispatch<React.SetStateAction<UpsertPlaybookScheduleData>>;
}

export function AdvancedScheduleEditor({ draft, t, setDraft }: Props) {
  if (!draft.advanced) return null;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>{t('schedule.advanced.variant')}</Label>
        <Select
          value={
            draft.advanced.variant === 'every_n_days' ? 'weekdays' : draft.advanced.variant
          }
          onValueChange={(v) => {
            const variant = v as 'weekdays' | 'weekend';
            setDraft((d) => ({
              ...d,
              advanced: {
                variant,
                intervalDays: null,
                timeLocal: d.advanced?.timeLocal ?? '09:00',
                monthOfYear: variant === 'weekend' ? d.advanced?.monthOfYear ?? null : null,
                weekOfMonth: variant === 'weekend' ? d.advanced?.weekOfMonth ?? null : null,
              },
            }));
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekdays">{t('schedule.advanced.weekdays')}</SelectItem>
            <SelectItem value="weekend">{t('schedule.advanced.weekend')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {draft.advanced.variant === 'weekend' ? (
        <WeekendEditor draft={draft} t={t} setDraft={setDraft} />
      ) : (
        <WeekdaysEditor draft={draft} t={t} setDraft={setDraft} />
      )}
    </div>
  );
}

function WeekendEditor({ draft, t, setDraft }: Props) {
  const adv = draft.advanced!;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {t('schedule.advancedWeekendCardTitle')}
        </span>
        {(adv.monthOfYear != null || adv.weekOfMonth != null) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-9 gap-1.5 px-2.5"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                advanced: {
                  ...d.advanced!,
                  monthOfYear: null,
                  weekOfMonth: null,
                },
              }))
            }
          >
            <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t('schedule.weekendClearFilters')}</span>
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {[0, 6]
          .map((wd) => t(`schedule.weekdays.${wd}` as ModuleTranslationKey<'playbook'>))
          .join(' · ')}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">{t('schedule.month')}</Label>
          <Select
            value={adv.monthOfYear == null ? 'all' : String(adv.monthOfYear)}
            onValueChange={(v) =>
              setDraft((d) => ({
                ...d,
                advanced: {
                  ...d.advanced!,
                  monthOfYear: v === 'all' ? null : Number(v),
                },
              }))
            }
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
          <Label className="text-xs">{t('schedule.advanced.weekInMonth')}</Label>
          <Select
            value={adv.weekOfMonth == null ? 'all' : String(adv.weekOfMonth)}
            onValueChange={(v) =>
              setDraft((d) => ({
                ...d,
                advanced: {
                  ...d.advanced!,
                  weekOfMonth: v === 'all' ? null : Number(v),
                },
              }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('schedule.weekEvery')}</SelectItem>
              {[1, 2, 3, 4, 5].map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {t(`schedule.weekBand.${w}` as ModuleTranslationKey<'playbook'>)}
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
            value={timeLocalFromInput(adv.timeLocal ?? '') || '09:00'}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                advanced: {
                  ...d.advanced!,
                  timeLocal: timeLocalFromInput(e.target.value) || '09:00',
                },
              }))
            }
          />
        </div>
      </div>
    </div>
  );
}

function WeekdaysEditor({ draft, t, setDraft }: Props) {
  const adv = draft.advanced!;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm">
      <div className="text-xs font-medium text-foreground">
        {t('schedule.advancedWeekdaysCardTitle' as ModuleTranslationKey<'playbook'>)}
      </div>
      <div
        className="flex flex-wrap gap-2"
        role="list"
        aria-label={t('schedule.weekdaysBusinessAria' as ModuleTranslationKey<'playbook'>)}
      >
        {WEEKDAY_BUSINESS_INDICES.map((wd) => (
          <span
            key={wd}
            role="listitem"
            className={cn(
              'inline-flex min-h-9 min-w-[2.5rem] select-none items-center justify-center',
              'rounded-lg border border-primary/20 bg-primary/10 px-2.5 text-sm font-semibold',
              'text-primary shadow-sm ring-1 ring-primary/10',
              'tabular-nums',
            )}
          >
            {t(`schedule.weekdays.${wd}` as ModuleTranslationKey<'playbook'>)}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t('schedule.advancedWeekdaysHint' as ModuleTranslationKey<'playbook'>)}
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">{t('schedule.time')}</Label>
        <Input
          type="time"
          step={60}
          className="bg-background w-full max-w-full min-h-10 sm:max-w-[12rem]"
          value={timeLocalFromInput(adv.timeLocal ?? '') || '09:00'}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              advanced: {
                ...d.advanced!,
                timeLocal: timeLocalFromInput(e.target.value) || '09:00',
              },
            }))
          }
        />
      </div>
    </div>
  );
}
