import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { CalendarCheck2, CalendarOff } from 'lucide-react';
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
  AdvancedScheduleVariant,
} from '../../types';
import { validateUpsertSchedulePayload } from '../../utils/scheduleValidation';
import { getDefaultScheduleTimezone } from '../../constants/schedule.constants';
import { timeLocalFromInput } from './timeInput';

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
    base.monthly = { slots: s.monthly.slots.map((x) => ({ ...x })) };
  }
  if (s.type === 'advanced' && s.advanced) {
    base.advanced = {
      variant: s.advanced.variant,
      intervalDays: s.advanced.intervalDays ?? null,
      timeLocal: s.advanced.timeLocal ?? null,
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
  const { t } = useModuleTranslation('playbook');
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
        next.monthly = d.monthly ?? { slots: [{ dayOfMonth: 1, timeLocal: '09:00' }] };
      }
      if (type === 'advanced') {
        next.advanced = d.advanced ?? {
          variant: 'weekdays',
          intervalDays: null,
          timeLocal: '09:00',
        };
      }
      return next;
    });
  };

  const buildPayload = useCallback((): UpsertPlaybookScheduleData => {
    if (!draft.enabled) {
      return { enabled: false };
    }
    return {
      ...draft,
      timezone: getDefaultScheduleTimezone(),
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
                <div className="space-y-2">
                  <Label>{t('schedule.times')}</Label>
                  {(draft.daily?.timesLocal ?? ['09:00']).map((time, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input
                        type="time"
                        step={60}
                        className="w-[min(100%,9rem)] bg-background"
                        value={timeLocalFromInput(time) || '09:00'}
                        onChange={(e) => {
                          const times = [...(draft.daily?.timesLocal ?? [])];
                          times[i] = timeLocalFromInput(e.target.value) || '09:00';
                          setDraft((d) => ({ ...d, daily: { timesLocal: times } }));
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const times = [...(draft.daily?.timesLocal ?? [])].filter((_, j) => j !== i);
                          setDraft((d) => ({ ...d, daily: { timesLocal: times.length ? times : ['09:00'] } }));
                        }}
                      >
                        −
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
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
                <div className="space-y-2">
                  {(draft.weekly?.slots ?? []).map((slot, i) => (
                    <div key={i} className="flex flex-wrap gap-2 items-end">
                      <div className="w-32">
                        <Label className="text-xs">{t('schedule.weekday')}</Label>
                        <Select
                          value={String(slot.weekday)}
                          onValueChange={(v) => {
                            const slots = [...(draft.weekly?.slots ?? [])];
                            slots[i] = { ...slots[i], weekday: Number(v) };
                            setDraft((d) => ({ ...d, weekly: { slots } }));
                          }}
                        >
                          <SelectTrigger>
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
                      <div className="flex-1 min-w-[100px]">
                        <Label className="text-xs">{t('schedule.time')}</Label>
                        <Input
                          type="time"
                          step={60}
                          className="bg-background"
                          value={timeLocalFromInput(slot.timeLocal) || '09:00'}
                          onChange={(e) => {
                            const slots = [...(draft.weekly?.slots ?? [])];
                            slots[i] = { ...slots[i], timeLocal: timeLocalFromInput(e.target.value) || '09:00' };
                            setDraft((d) => ({ ...d, weekly: { slots } }));
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          const slots = [...(draft.weekly?.slots ?? [])].filter((_, j) => j !== i);
                          setDraft((d) => ({
                            ...d,
                            weekly: { slots: slots.length ? slots : [{ weekday: 1, timeLocal: '09:00' }] },
                          }));
                        }}
                      >
                        −
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
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
                  {(draft.monthly?.slots ?? []).map((slot, i) => (
                    <div key={i} className="flex flex-wrap gap-2 items-end">
                      <div className="w-28">
                        <Label className="text-xs">{t('schedule.dayOfMonth')}</Label>
                        <Input
                          type="number"
                          min={-1}
                          max={31}
                          value={slot.dayOfMonth}
                          onChange={(e) => {
                            const slots = [...(draft.monthly?.slots ?? [])];
                            slots[i] = { ...slots[i], dayOfMonth: Number(e.target.value) };
                            setDraft((d) => ({ ...d, monthly: { slots } }));
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-[100px]">
                        <Label className="text-xs">{t('schedule.time')}</Label>
                        <Input
                          type="time"
                          step={60}
                          className="bg-background"
                          value={timeLocalFromInput(slot.timeLocal) || '09:00'}
                          onChange={(e) => {
                            const slots = [...(draft.monthly?.slots ?? [])];
                            slots[i] = { ...slots[i], timeLocal: timeLocalFromInput(e.target.value) || '09:00' };
                            setDraft((d) => ({ ...d, monthly: { slots } }));
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          const slots = [...(draft.monthly?.slots ?? [])].filter((_, j) => j !== i);
                          setDraft((d) => ({
                            ...d,
                            monthly: {
                              slots: slots.length ? slots : [{ dayOfMonth: 1, timeLocal: '09:00' }],
                            },
                          }));
                        }}
                      >
                        −
                      </Button>
                    </div>
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
                          slots: [...(d.monthly?.slots ?? []), { dayOfMonth: 1, timeLocal: '09:00' }],
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
                      value={draft.advanced.variant}
                      onValueChange={(v) => {
                        const variant = v as AdvancedScheduleVariant;
                        setDraft((d) => ({
                          ...d,
                          advanced: {
                            variant,
                            intervalDays: variant === 'every_n_days' ? d.advanced?.intervalDays ?? 1 : null,
                            timeLocal: d.advanced?.timeLocal ?? '09:00',
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
                        <SelectItem value="every_n_days">{t('schedule.advanced.everyN')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {draft.advanced.variant === 'every_n_days' && (
                    <div className="space-y-2">
                      <Label>{t('schedule.advanced.interval')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={366}
                        value={draft.advanced.intervalDays ?? ''}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            advanced: {
                              ...d.advanced!,
                              intervalDays: e.target.value ? Number(e.target.value) : null,
                            },
                          }))
                        }
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>{t('schedule.time')}</Label>
                    <Input
                      type="time"
                      step={60}
                      className="max-w-[9rem] bg-background"
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
