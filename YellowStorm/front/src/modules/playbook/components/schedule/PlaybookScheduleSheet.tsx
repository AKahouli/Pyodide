import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { CalendarCheck2, CalendarOff, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import { usePlaybookStore } from '../../store';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization/types';
import type {
  ExecutionScheduleData,
  ExecutionScheduleType,
  UpsertPlaybookScheduleData,
} from '../../types';
import { validateUpsertSchedulePayload } from '../../utils/scheduleValidation';
import { formatNextMonthlyOccurrencePreview } from '../../utils/scheduleDisplay';
import { getDefaultScheduleTimezone } from '../../constants/schedule.constants';
import { clampMonthlyDay, maxDayForMonthlySlot } from '../../utils/monthlyCalendar';
import { timeLocalFromInput } from './timeInput';

/** Mon–Fri (1–5) for business-day UI strips */
const WEEKDAY_BUSINESS_INDICES = [1, 2, 3, 4, 5] as const;

function defaultSchedule(): UpsertPlaybookScheduleData {
  return {
    enabled: true,
    type: 'daily',
    daily: { timesLocal: ['09:00'] },
  };
}

function fromExecutionSchedule(s: ExecutionScheduleData | null): UpsertPlaybookScheduleData {
  if (!s || !s.enabled || !s.type) {
    return defaultSchedule();
  }
  const base: UpsertPlaybookScheduleData = {
    enabled: true,
    type: s.type,
  };
  if (s.type === 'daily' && s.daily) {
    base.daily = { timesLocal: [...s.daily.timesLocal] };
  }
  if (s.type === 'weekly' && s.weekly) {
    base.weekly = { slots: s.weekly.slots.map((x) => ({ ...x })) };
  }
  if (s.type === 'monthly' && s.monthly) {
    const y = new Date().getFullYear();
    base.monthly = {
      slots: s.monthly.slots.map((x) => ({
        monthOfYear: x.monthOfYear ?? null,
        dayOfMonth: clampMonthlyDay(x.dayOfMonth, x.monthOfYear ?? null, y),
        timeLocal: x.timeLocal,
      })),
    };
  }
  if (s.type === 'advanced' && s.advanced) {
    const adv = s.advanced;
    // UI no longer offers every_n_days; map legacy payloads to weekdays
    const variant =
      adv.variant === 'every_n_days' ? 'weekdays' : adv.variant;
    base.advanced = {
      variant,
      intervalDays: null,
      timeLocal: adv.timeLocal ?? null,
      monthOfYear: adv.monthOfYear ?? null,
      weekOfMonth: adv.weekOfMonth ?? null,
    };
  }
  return base;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbookId: string;
  schedule: ExecutionScheduleData | null;
}

export function PlaybookScheduleSheet({ open, onOpenChange, playbookId, schedule }: Props) {
  const { t, language } = useModuleTranslation('playbook');
  const upsertPlaybookSchedule = usePlaybookStore((s) => s.upsertPlaybookSchedule);
  const clearPlaybookSchedule = usePlaybookStore((s) => s.clearPlaybookSchedule);
  const scheduleSaving = usePlaybookStore((s) => s.scheduleSaving);

  const [draft, setDraft] = useState<UpsertPlaybookScheduleData>(defaultSchedule());

  useEffect(() => {
    if (open) {
      setDraft(fromExecutionSchedule(schedule));
    }
  }, [open, schedule]);

  const setType = (type: ExecutionScheduleType) => {
    setDraft((d) => {
      const next: UpsertPlaybookScheduleData = {
        ...d,
        enabled: true,
        type,
        daily: undefined,
        weekly: undefined,
        monthly: undefined,
        advanced: undefined,
      };
      if (type === 'daily') next.daily = d.daily ?? { timesLocal: ['09:00'] };
      if (type === 'weekly') {
        next.weekly = d.weekly ?? { slots: [{ weekday: 1, timeLocal: '09:00' }] };
      }
      if (type === 'monthly') {
        next.monthly = d.monthly ?? { slots: [{ monthOfYear: 1, dayOfMonth: 1, timeLocal: '09:00' }] };
      }
      if (type === 'advanced') {
        next.advanced = d.advanced ?? {
          variant: 'weekdays',
          intervalDays: null,
          timeLocal: '09:00',
          monthOfYear: null,
          weekOfMonth: null,
        };
      }
      return next;
    });
  };

  const buildPayload = useCallback((): UpsertPlaybookScheduleData => {
    if (!draft.enabled) {
      return { enabled: false };
    }
    const tz = getDefaultScheduleTimezone();
    const y = new Date().getFullYear();
    if (draft.type === 'monthly' && draft.monthly?.slots?.length) {
      return {
        ...draft,
        timezone: tz,
        monthly: {
          slots: draft.monthly.slots.map((s) => ({
            ...s,
            dayOfMonth: clampMonthlyDay(s.dayOfMonth, s.monthOfYear, y),
          })),
        },
      };
    }
    if (draft.type === 'advanced' && draft.advanced?.variant === 'every_n_days') {
      return {
        ...draft,
        timezone: tz,
        advanced: {
          ...draft.advanced,
          variant: 'weekdays',
          intervalDays: null,
        },
      };
    }
    return {
      ...draft,
      timezone: tz,
    };
  }, [draft]);

  const handleSave = async () => {
    const payload = buildPayload();
    const errKey = validateUpsertSchedulePayload(payload);
    if (errKey) {
      toast.error(t(errKey as ModuleTranslationKey<'playbook'>));
      return;
    }
    try {
      await upsertPlaybookSchedule(playbookId, payload);
      onOpenChange(false);
    } catch {
      /* toast in store */
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(t('schedule.confirmClear'))) return;
    try {
      await clearPlaybookSchedule(playbookId);
      onOpenChange(false);
    } catch {
      /* toast in store */
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="sm:max-w-md w-full overflow-y-auto flex flex-col"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{t('schedule.title')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4 flex-1">
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

          {draft.enabled && (
            <>
              <div className="space-y-2">
                <Label>{t('schedule.mode')}</Label>
                <Select value={draft.type} onValueChange={(v) => setType(v as ExecutionScheduleType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">{t('schedule.type.daily')}</SelectItem>
                    <SelectItem value="weekly">{t('schedule.type.weekly')}</SelectItem>
                    <SelectItem value="monthly">{t('schedule.type.monthly')}</SelectItem>
                    <SelectItem value="advanced">{t('schedule.type.advanced')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {draft.type === 'daily' && (
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
                    {(draft.daily?.timesLocal ?? ['09:00']).map((time, i) => {
                      const timesCount = (draft.daily?.timesLocal ?? ['09:00']).length;
                      const canRemoveTime = timesCount > 1;
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
                              const times = [...(draft.daily?.timesLocal ?? [])];
                              times[i] = timeLocalFromInput(e.target.value) || '09:00';
                              setDraft((d) => ({ ...d, daily: { timesLocal: times } }));
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
                              const times = [...(draft.daily?.timesLocal ?? [])].filter((_, j) => j !== i);
                              setDraft((d) => ({ ...d, daily: { timesLocal: times.length ? times : ['09:00'] } }));
                            }}
                          >
                            <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                            <span>{t('schedule.removeTime' as ModuleTranslationKey<'playbook'>)}</span>
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
              )}

              {draft.type === 'weekly' && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t('schedule.weeklyExplainer' as ModuleTranslationKey<'playbook'>)}
                  </p>
                  {(draft.weekly?.slots ?? []).map((slot, i) => {
                    const weeklySlotsCount = (draft.weekly?.slots ?? []).length;
                    const canRemoveWeeklySlot = weeklySlotsCount > 1;
                    return (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm"
                    >
                      <div
                        className={cn(
                          'flex items-center gap-2',
                          canRemoveWeeklySlot ? 'justify-between' : 'justify-start',
                        )}
                      >
                        <span className="text-xs font-medium text-foreground">
                          {t('schedule.weeklySlotLabel' as ModuleTranslationKey<'playbook'>, { n: i + 1 })}
                        </span>
                        {canRemoveWeeklySlot ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 gap-1.5 h-9 px-2.5"
                            aria-label={t('schedule.removeWeeklySlotAria' as ModuleTranslationKey<'playbook'>)}
                            onClick={() => {
                              const slots = [...(draft.weekly?.slots ?? [])].filter((_, j) => j !== i);
                              setDraft((d) => ({
                                ...d,
                                weekly: { slots: slots.length ? slots : [{ weekday: 1, timeLocal: '09:00' }] },
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
                              const slots = [...(draft.weekly?.slots ?? [])];
                              slots[i] = { ...slots[i], weekday: Number(v) };
                              setDraft((d) => ({ ...d, weekly: { slots } }));
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
                              const slots = [...(draft.weekly?.slots ?? [])];
                              slots[i] = {
                                ...slots[i],
                                timeLocal: timeLocalFromInput(e.target.value) || '09:00',
                              };
                              setDraft((d) => ({ ...d, weekly: { slots } }));
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
              )}

              {draft.type === 'monthly' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('schedule.monthlyRepeatExplainer')}</p>
                  {(draft.monthly?.slots ?? []).map((slot, i) => {
                    const monthlySlotsCount = (draft.monthly?.slots ?? []).length;
                    const canRemoveMonthlySlot = monthlySlotsCount > 1;
                    const year = new Date().getFullYear();
                    const maxDay = maxDayForMonthlySlot(slot.monthOfYear, year);
                    const dayClamped = clampMonthlyDay(slot.dayOfMonth, slot.monthOfYear, year);
                    const preview = formatNextMonthlyOccurrencePreview(
                      dayClamped,
                      slot.timeLocal,
                      language ?? 'en',
                      slot.monthOfYear ?? null,
                    );
                    const daySelectValue =
                      slot.dayOfMonth === -1
                        ? '-1'
                        : slot.dayOfMonth === 0
                          ? '0'
                          : String(dayClamped);

                    return (
                      <div
                        key={i}
                        className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm"
                      >
                        <div
                          className={cn(
                            'flex items-center gap-2',
                            canRemoveMonthlySlot ? 'justify-between' : 'justify-start',
                          )}
                        >
                          <span className="text-xs font-medium text-foreground">
                            {t('schedule.monthlySlotLabel', { n: i + 1 })}
                          </span>
                          {canRemoveMonthlySlot ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0 gap-1.5 h-9 px-2.5"
                              aria-label={t('schedule.removeSlotAria')}
                              onClick={() => {
                                const slots = [...(draft.monthly?.slots ?? [])].filter((_, j) => j !== i);
                                setDraft((d) => ({
                                  ...d,
                                  monthly: {
                                    slots: slots.length
                                      ? slots
                                      : [{ monthOfYear: 1, dayOfMonth: 1, timeLocal: '09:00' }],
                                  },
                                }));
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
                                const slots = [...(draft.monthly?.slots ?? [])];
                                const newMonth = v === 'all' ? null : Number(v);
                                const y = new Date().getFullYear();
                                const cur = slots[i];
                                slots[i] = {
                                  ...cur,
                                  monthOfYear: newMonth,
                                  dayOfMonth: clampMonthlyDay(cur.dayOfMonth, newMonth, y),
                                };
                                setDraft((d) => ({ ...d, monthly: { slots } }));
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
                              key={`day-${i}-${slot.monthOfYear ?? 'all'}-${maxDay}`}
                              value={daySelectValue}
                              onValueChange={(v) => {
                                const slots = [...(draft.monthly?.slots ?? [])];
                                const y = new Date().getFullYear();
                                const cur = slots[i];
                                const next =
                                  v === '-1'
                                    ? -1
                                    : v === '0'
                                      ? 0
                                      : clampMonthlyDay(Number(v), cur.monthOfYear, y);
                                slots[i] = { ...slots[i], dayOfMonth: next };
                                setDraft((d) => ({ ...d, monthly: { slots } }));
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
                                const slots = [...(draft.monthly?.slots ?? [])];
                                slots[i] = {
                                  ...slots[i],
                                  timeLocal: timeLocalFromInput(e.target.value) || '09:00',
                                };
                                setDraft((d) => ({ ...d, monthly: { slots } }));
                              }}
                            />
                          </div>
                        </div>
                        {preview ? (
                          <p className="text-xs text-muted-foreground pl-0.5">
                            {t('schedule.monthlyNextExample', { date: preview })}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
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
              )}

              {draft.type === 'advanced' && draft.advanced && (
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
                    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">
                          {t('schedule.advancedWeekendCardTitle')}
                        </span>
                        {(draft.advanced.monthOfYear != null ||
                          draft.advanced.weekOfMonth != null) && (
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
                            value={
                              draft.advanced.monthOfYear == null ? 'all' : String(draft.advanced.monthOfYear)
                            }
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
                            value={
                              draft.advanced.weekOfMonth == null
                                ? 'all'
                                : String(draft.advanced.weekOfMonth)
                            }
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
                            value={timeLocalFromInput(draft.advanced.timeLocal ?? '') || '09:00'}
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
                  ) : (
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
                          value={timeLocalFromInput(draft.advanced.timeLocal ?? '') || '09:00'}
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
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t pt-4 mt-auto flex flex-wrap gap-2 justify-end">
          {schedule?.enabled && (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              onClick={() => void handleRemove()}
              disabled={scheduleSaving}
            >
              {t('schedule.remove')}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('schedule.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={scheduleSaving}>
            {scheduleSaving ? t('schedule.saving') : t('schedule.save')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
