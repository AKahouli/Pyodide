import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { usePlaybookStore } from '../../store';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization/types';
import type {
  ExecutionScheduleData,
  ExecutionScheduleType,
  UpsertPlaybookScheduleData,
} from '../../types';
import { validateUpsertSchedulePayload } from '../../utils/scheduleValidation';
import { getDefaultScheduleTimezone } from '../../constants/schedule.constants';
import { clampMonthlyDay } from '../../utils/monthlyCalendar';
import { defaultSchedule, fromExecutionSchedule } from './helpers';
import { ScheduleActiveToggle } from './ScheduleActiveToggle';
import { ScheduleTypeSelector } from './ScheduleTypeSelector';
import { DailyScheduleEditor } from './DailyScheduleEditor';
import { WeeklyScheduleEditor } from './WeeklyScheduleEditor';
import { MonthlyScheduleEditor } from './MonthlyScheduleEditor';
import { AdvancedScheduleEditor } from './AdvancedScheduleEditor';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbookId: string;
  schedule: ExecutionScheduleData | null;
}

export function PlaybookScheduleSheet({ open, onOpenChange, playbookId, schedule }: Props) {
  const { t, language } = useModuleTranslation('playbook');
  const upsertPlaybookTriggerSchedule = usePlaybookStore((s) => s.upsertPlaybookTriggerSchedule);
  const clearPlaybookTriggerSchedule = usePlaybookStore((s) => s.clearPlaybookTriggerSchedule);
  const triggerSaving = usePlaybookStore((s) => s.triggerSaving);

  const [draft, setDraft] = useState<UpsertPlaybookScheduleData>(defaultSchedule());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const automatedTriggerType = draft.enabled ? 'schedule' : 'none';

  useEffect(() => {
    if (open) {
      setDraft(schedule?.enabled ? fromExecutionSchedule(schedule) : { enabled: false });
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

  const buildPayload = (): UpsertPlaybookScheduleData => {
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
  };

  const handleSave = async () => {
    const payload = buildPayload();
    const errKey = validateUpsertSchedulePayload(payload);
    if (errKey) {
      toast.error(t(errKey as ModuleTranslationKey<'playbook'>));
      return;
    }
    try {
      await upsertPlaybookTriggerSchedule(playbookId, payload);
      onOpenChange(false);
    } catch {
      /* toast in store */
    }
  };

  const handleRemove = async () => {
    setShowConfirmDialog(false);
    try {
      await clearPlaybookTriggerSchedule(playbookId);
      onOpenChange(false);
    } catch {
      /* toast in store */
    }
  };

  const handleAutomatedTriggerChange = (value: string) => {
    if (value === 'schedule') {
      setDraft((current) => {
        const next = fromExecutionSchedule(schedule);
        return {
          ...next,
          enabled: true,
          type: next.type ?? current.type ?? 'daily',
          daily: next.daily ?? current.daily ?? { timesLocal: ['09:00'] },
          weekly: next.weekly ?? current.weekly,
          monthly: next.monthly ?? current.monthly,
          advanced: next.advanced ?? current.advanced,
        };
      });
      return;
    }

    setDraft({ enabled: false });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="sm:max-w-md w-full overflow-y-auto flex flex-col"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{t('schedule.title')}</SheetTitle>
          <SheetDescription>{t('triggers.description')}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4 flex-1">
          <section className="rounded-xl border bg-muted/20 p-4 space-y-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">{t('triggers.manual.title')}</div>
              <p className="text-sm text-muted-foreground">{t('triggers.manual.description')}</p>
            </div>
            <div className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {t('triggers.manual.badge')}
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">{t('triggers.automated.title')}</div>
              <p className="text-sm text-muted-foreground">{t('triggers.automated.description')}</p>
            </div>

            <RadioGroup
              value={automatedTriggerType}
              onValueChange={handleAutomatedTriggerChange}
              className="space-y-3"
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 hover:border-primary/40">
                <RadioGroupItem value="none" id="trigger-none" className="mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t('triggers.automated.noneTitle')}</div>
                  <p className="text-sm text-muted-foreground">{t('triggers.automated.noneDescription')}</p>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 hover:border-primary/40">
                <RadioGroupItem value="schedule" id="trigger-schedule" className="mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t('triggers.automated.scheduleTitle')}</div>
                  <p className="text-sm text-muted-foreground">{t('triggers.automated.scheduleDescription')}</p>
                </div>
              </label>

              <div className="flex items-start gap-3 rounded-xl border border-dashed p-4 opacity-70">
                <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/50" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>{t('triggers.automated.mailTitle')}</span>
                    <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('triggers.comingSoon')}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{t('triggers.automated.mailDescription')}</p>
                </div>
              </div>
            </RadioGroup>
          </section>

          {automatedTriggerType === 'schedule' && (
            <>
              <ScheduleActiveToggle
                draft={draft}
                schedule={schedule}
                t={t}
                setDraft={setDraft}
              />

              <ScheduleTypeSelector
                type={draft.type ?? 'daily'}
                onTypeChange={setType}
                t={t}
              />

              {draft.type === 'daily' && (
                <DailyScheduleEditor
                  draft={draft}
                  t={t}
                  setDraft={setDraft}
                />
              )}

              {draft.type === 'weekly' && (
                <WeeklyScheduleEditor
                  draft={draft}
                  t={t}
                  setDraft={setDraft}
                />
              )}

              {draft.type === 'monthly' && (
                <MonthlyScheduleEditor
                  draft={draft}
                  t={t}
                  setDraft={setDraft}
                  language={language ?? 'en'}
                />
              )}

              {draft.type === 'advanced' && draft.advanced && (
                <AdvancedScheduleEditor
                  draft={draft}
                  t={t}
                  setDraft={setDraft}
                />
              )}
            </>
          )}
        </div>

        <div className="border-t pt-4 mt-auto flex flex-wrap gap-2 justify-end">
          {schedule?.enabled && automatedTriggerType === 'schedule' && (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              onClick={() => setShowConfirmDialog(true)}
              disabled={triggerSaving}
            >
              {t('schedule.remove')}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('schedule.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={triggerSaving}>
            {triggerSaving ? t('schedule.saving') : t('schedule.save')}
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('schedule.confirmClear')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('schedule.confirmClearDesc' as ModuleTranslationKey<'playbook'>, undefined) ?? t('schedule.confirmClear')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('schedule.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRemove()}>
              {t('schedule.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
