import { useEffect, useRef, useState } from 'react';
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
import { Separator } from '@/components/ui/separator';
import { usePlaybookStore } from '../../store';
import { useConnectedAppStore, useMailboxCapability } from '@/modules/connected-app/store';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization/types';
import type {
  ExecutionScheduleData,
  ExecutionScheduleType,
  PlaybookMailTrigger,
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
  mailTrigger?: PlaybookMailTrigger | null;
}

export function PlaybookScheduleSheet({ open, onOpenChange, playbookId, schedule, mailTrigger = null }: Props) {
  const { t, language } = useModuleTranslation('playbook');
  const upsertPlaybookTriggerSchedule = usePlaybookStore((s) => s.upsertPlaybookTriggerSchedule);
  const clearPlaybookTriggerSchedule = usePlaybookStore((s) => s.clearPlaybookTriggerSchedule);
  const upsertPlaybookTriggerMail = usePlaybookStore((s) => s.upsertPlaybookTriggerMail);
  const clearPlaybookTriggerMail = usePlaybookStore((s) => s.clearPlaybookTriggerMail);
  const syncPlaybookTriggerMailSubscription = usePlaybookStore((s) => s.syncPlaybookTriggerMailSubscription);
  const triggerSaving = usePlaybookStore((s) => s.triggerSaving);
  const fetchMailboxCapability = useConnectedAppStore((s) => s.fetchMailboxCapability);
  const mailboxCapability = useMailboxCapability();

  const [draft, setDraft] = useState<UpsertPlaybookScheduleData>(defaultSchedule());
  const [mailDraft, setMailDraft] = useState({
    mailboxAppKey: 'microsoft',
    notificationUrl: '',
    autoRenewUntil: '',
    attachmentImportEnabled: false,
    allowedAttachmentExtensions: '',
    from: '',
    subjectContains: '',
    bodyContains: '',
    hasAttachments: null as boolean | null,
  });

  /** Returns today's local date as YYYY-MM-DD for date input min/max */
  const getLocalToday = (): string => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  /** Converts a local YYYY-MM-DD into an ISO UTC timestamp at end-of-day */
  const localDateToEndOfDayUtc = (localDate: string): string => {
    const [y, m, d] = localDate.split('-').map(Number);
    const date = new Date(y, m - 1, d, 23, 59, 59, 999);
    return date.toISOString();
  };
  const [automatedTriggerType, setAutomatedTriggerType] = useState<'none' | 'schedule' | 'mail'>('none');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [mailboxCapabilityLoaded, setMailboxCapabilityLoaded] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      setMailboxCapabilityLoaded(false);
      void fetchMailboxCapability().finally(() => setMailboxCapabilityLoaded(true));
    }
  }, [open, fetchMailboxCapability]);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setDraft(schedule?.enabled ? fromExecutionSchedule(schedule) : { enabled: false });
    setAutomatedTriggerType(schedule?.enabled ? 'schedule' : mailTrigger?.enabled ? 'mail' : 'none');
    setMailDraft({
        mailboxAppKey: mailTrigger?.config?.mailboxAppKey ?? mailboxCapability?.appKey ?? 'microsoft',
        notificationUrl: mailTrigger?.config?.notificationUrl ?? '',
        autoRenewUntil: mailTrigger?.config?.autoRenewUntil
          ? (() => {
              const d = new Date(mailTrigger.config.autoRenewUntil!);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              return `${y}-${m}-${day}`;
            })()
          : '',
        attachmentImportEnabled: mailTrigger?.config?.attachmentImportEnabled === true,
        allowedAttachmentExtensions: mailTrigger?.config?.allowedAttachmentExtensions?.join(', ') ?? '',
        from: mailTrigger?.config?.filters.from.join('\n') ?? '',
        subjectContains: mailTrigger?.config?.filters.subjectContains.join('\n') ?? '',
        bodyContains: mailTrigger?.config?.filters.bodyContains.join('\n') ?? '',
        hasAttachments: mailTrigger?.config?.filters.hasAttachments === true,
    });
  }, [open, schedule, mailTrigger, mailboxCapability]);

  useEffect(() => {
    if (!open || mailTrigger?.config?.mailboxAppKey || !mailboxCapability?.appKey) return;
    setMailDraft((current) => ({ ...current, mailboxAppKey: mailboxCapability.appKey }));
  }, [open, mailTrigger?.config?.mailboxAppKey, mailboxCapability?.appKey]);

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
      if (automatedTriggerType === 'schedule') {
        await upsertPlaybookTriggerSchedule(playbookId, payload);
      } else if (automatedTriggerType === 'mail') {
        await upsertPlaybookTriggerMail(playbookId, {
          enabled: true,
          mailboxAppKey: mailDraft.mailboxAppKey,
          autoRenewUntil: mailDraft.autoRenewUntil ? localDateToEndOfDayUtc(mailDraft.autoRenewUntil) : null,
          attachmentImportEnabled: mailDraft.attachmentImportEnabled,
          allowedAttachmentExtensions: mailDraft.allowedAttachmentExtensions
            .split(',')
            .map((value) => value.trim().replace(/^\./, '').toLowerCase())
            .filter(Boolean),
          filters: {
            from: mailDraft.from.split('\n').map((v) => v.trim()).filter(Boolean),
            subjectContains: mailDraft.subjectContains.split('\n').map((v) => v.trim()).filter(Boolean),
            bodyContains: mailDraft.bodyContains.split('\n').map((v) => v.trim()).filter(Boolean),
            hasAttachments: mailDraft.hasAttachments,
          },
        });
      } else {
        await upsertPlaybookTriggerSchedule(playbookId, { enabled: false });
      }
      onOpenChange(false);
    } catch {
      /* toast in store */
    }
  };

  const handleRemove = async () => {
    setShowConfirmDialog(false);
    try {
      if (automatedTriggerType === 'mail') {
        await clearPlaybookTriggerMail(playbookId);
      } else {
        await clearPlaybookTriggerSchedule(playbookId);
      }
      onOpenChange(false);
    } catch {
      /* toast in store */
    }
  };

  const handleAutomatedTriggerChange = (value: string) => {
    if (value === 'schedule') {
      setAutomatedTriggerType('schedule');
      setDraft((current) => ({
        ...current,
        enabled: true,
      }));
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

    if (value === 'mail') {
      setAutomatedTriggerType('mail');
      setDraft({ enabled: false });
      return;
    }

    setAutomatedTriggerType('none');
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

            <div className="space-y-3" role="radiogroup" aria-label={t('triggers.automated.title')}>
              <button
                type="button"
                className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left hover:border-primary/40 ${
                  automatedTriggerType === 'none' ? 'border-primary bg-primary/5' : ''
                }`}
                onClick={() => handleAutomatedTriggerChange('none')}
                role="radio"
                aria-checked={automatedTriggerType === 'none'}
              >
                <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-primary">
                  {automatedTriggerType === 'none' && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t('triggers.automated.noneTitle')}</div>
                  <p className="text-sm text-muted-foreground">{t('triggers.automated.noneDescription')}</p>
                </div>
              </button>

              <button
                type="button"
                className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left hover:border-primary/40 ${
                  automatedTriggerType === 'schedule' ? 'border-primary bg-primary/5' : ''
                }`}
                onClick={() => handleAutomatedTriggerChange('schedule')}
                role="radio"
                aria-checked={automatedTriggerType === 'schedule'}
              >
                <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-primary">
                  {automatedTriggerType === 'schedule' && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t('triggers.automated.scheduleTitle')}</div>
                  <p className="text-sm text-muted-foreground">{t('triggers.automated.scheduleDescription')}</p>
                </div>
              </button>

              <button
                type="button"
                className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left hover:border-primary/40 ${
                  automatedTriggerType === 'mail' ? 'border-primary bg-primary/5' : ''
                }`}
                onClick={() => handleAutomatedTriggerChange('mail')}
                role="radio"
                aria-checked={automatedTriggerType === 'mail'}
              >
                <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-primary">
                  {automatedTriggerType === 'mail' && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>{t('triggers.automated.mailTitle')}</span>
                    {mailTrigger?.config?.runtimeEnabled ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        {t('triggers.mailConfig.subscriptionActive')}
                      </span>
                    ) : mailboxCapability?.mailboxReady ? (
                      <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('triggers.automated.mailStatusReady')}
                      </span>
                    ) : mailboxCapabilityLoaded ? (
                      <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('triggers.automated.mailStatusSetup')}
                      </span>
                    ) : (
                      <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('triggers.automated.mailStatusLoading')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{t('triggers.automated.mailDescription')}</p>
                  {!mailboxCapabilityLoaded && (
                    <p className="text-xs text-muted-foreground">
                      {t('triggers.automated.mailLoading')}
                    </p>
                  )}
                  {mailboxCapability?.mailboxReady && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      {t('triggers.automated.mailReady')}
                    </p>
                  )}
                  {mailboxCapability?.connected && !mailboxCapability.mailboxReady && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t('triggers.automated.mailScopesMissing', {
                        scopes: mailboxCapability.missingScopes.join(', '),
                      })}
                    </p>
                  )}
                  {!mailboxCapability?.connected && (
                    <p className="text-xs text-muted-foreground">
                      {t('triggers.automated.mailConnectRequired')}
                    </p>
                  )}
                </div>
              </button>
            </div>
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

          {automatedTriggerType === 'mail' && (
            <section className="space-y-4 rounded-xl border p-4">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('triggers.mailConfig.title')}</div>
                <p className="text-sm text-muted-foreground">{t('triggers.mailConfig.description')}</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mail-notification-url">
                  {t('triggers.mailConfig.notificationUrl')}
                </label>
                <input
                  id="mail-notification-url"
                  aria-label={t('triggers.mailConfig.notificationUrl')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={mailDraft.notificationUrl}
                  onChange={(e) =>
                    setMailDraft((current) => ({ ...current, notificationUrl: e.target.value }))
                  }
                  placeholder="https://your-public-url/api/v1/playbooks/mail/webhook"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mail-auto-renew-until">
                  {t('triggers.mailConfig.autoRenewUntil')}
                </label>
                <input
                  id="mail-auto-renew-until"
                  type="date"
                  aria-label={t('triggers.mailConfig.autoRenewUntil')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={mailDraft.autoRenewUntil}
                  min={getLocalToday()}
                  onChange={(e) =>
                    setMailDraft((current) => ({ ...current, autoRenewUntil: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">{t('triggers.mailConfig.autoRenewUntilHint')}</p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
                {mailTrigger?.config?.runtimeEnabled && mailTrigger?.config?.subscriptionId ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">{t('triggers.mailConfig.subscriptionActive')}</span>
                    </div>
                    {mailTrigger.config.subscriptionExpiresAt && (
                      <div className="text-muted-foreground pl-4">
                        {t('triggers.mailConfig.subscriptionExpiresAt', {
                          value: new Date(mailTrigger.config.subscriptionExpiresAt).toLocaleString(),
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                    <span>{t('triggers.mailConfig.subscriptionInactive')}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={triggerSaving || !mailboxCapability?.mailboxReady || !mailDraft.notificationUrl.trim()}
                  onClick={() =>
                    void syncPlaybookTriggerMailSubscription(playbookId, {
                      notificationUrl: mailDraft.notificationUrl.trim(),
                      autoRenewUntil: mailDraft.autoRenewUntil
                        ? localDateToEndOfDayUtc(mailDraft.autoRenewUntil)
                        : null,
                    })
                  }
                >
                  {t('triggers.mailConfig.syncSubscription')}
                </Button>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={t('triggers.mailConfig.attachmentImportEnabled')}
                  checked={mailDraft.attachmentImportEnabled}
                  onChange={(e) =>
                    setMailDraft((current) => ({ ...current, attachmentImportEnabled: e.target.checked }))
                  }
                />
                <span>{t('triggers.mailConfig.attachmentImportEnabled')}</span>
              </label>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mail-allowed-attachment-extensions">
                  {t('triggers.mailConfig.allowedAttachmentExtensions')}
                </label>
                <input
                  id="mail-allowed-attachment-extensions"
                  aria-label={t('triggers.mailConfig.allowedAttachmentExtensions')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={mailDraft.allowedAttachmentExtensions}
                  onChange={(e) =>
                    setMailDraft((current) => ({ ...current, allowedAttachmentExtensions: e.target.value }))
                  }
                  placeholder="pdf, docx, xlsx"
                  disabled={!mailDraft.attachmentImportEnabled}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mail-from-filter">
                  {t('triggers.mailConfig.from')}
                </label>
                <textarea
                  id="mail-from-filter"
                  aria-label={t('triggers.mailConfig.from')}
                  className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={mailDraft.from}
                  onChange={(e) => setMailDraft((current) => ({ ...current, from: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mail-subject-filter">
                  {t('triggers.mailConfig.subjectContains')}
                </label>
                <textarea
                  id="mail-subject-filter"
                  aria-label={t('triggers.mailConfig.subjectContains')}
                  className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={mailDraft.subjectContains}
                  onChange={(e) => setMailDraft((current) => ({ ...current, subjectContains: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mail-body-filter">
                  {t('triggers.mailConfig.bodyContains')}
                </label>
                <textarea
                  id="mail-body-filter"
                  aria-label={t('triggers.mailConfig.bodyContains')}
                  className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={mailDraft.bodyContains}
                  onChange={(e) => setMailDraft((current) => ({ ...current, bodyContains: e.target.value }))}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={t('triggers.mailConfig.hasAttachments')}
                  checked={mailDraft.hasAttachments === true}
                  onChange={(e) =>
                    setMailDraft((current) => ({
                      ...current,
                      hasAttachments: e.target.checked ? true : null,
                    }))
                  }
                />
                <span>{t('triggers.mailConfig.hasAttachments')}</span>
              </label>

              {mailTrigger?.config?.runtimeEnabled ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('triggers.mailConfig.runtimeNotice')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('triggers.mailConfig.runtimeNotice')}</p>
              )}
              {mailTrigger?.config?.autoRenewUntil && (
                <p className="text-xs text-muted-foreground">
                  {t('triggers.mailConfig.autoRenewUntilValue', {
                    value: new Date(mailTrigger.config.autoRenewUntil).toLocaleDateString(language),
                  })}
                </p>
              )}
            </section>
          )}
        </div>

        <div className="border-t pt-4 mt-auto flex flex-wrap gap-2 justify-end">
          {((schedule?.enabled && automatedTriggerType === 'schedule') ||
            (mailTrigger?.enabled && automatedTriggerType === 'mail')) && (
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
