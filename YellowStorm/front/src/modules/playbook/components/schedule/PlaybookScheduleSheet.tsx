import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
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
  const upsertPlaybookSchedule = usePlaybookStore((s) => s.upsertPlaybookSchedule);
  const clearPlaybookSchedule = usePlaybookStore((s) => s.clearPlaybookSchedule);
  const scheduleSaving = usePlaybookStore((s) => s.scheduleSaving);

  const [draft, setDraft] = useState<UpsertPlaybookScheduleData>(defaultSchedule());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

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
      await upsertPlaybookSchedule(playbookId, payload);
      onOpenChange(false);
    } catch {
      /* toast in store */
    }
  };

  const handleRemove = async () => {
    setShowConfirmDialog(false);
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
          <ScheduleActiveToggle
            draft={draft}
            schedule={schedule}
            t={t}
            setDraft={setDraft}
          />

          {draft.enabled && (
            <>
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
          {schedule?.enabled && (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              onClick={() => setShowConfirmDialog(true)}
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
