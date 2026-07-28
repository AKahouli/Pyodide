import { useEffect, useState } from 'react';
import { AlertTriangle, Gauge, Info, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminEvaluationSettings, getAllModels, updateAdminEvaluationSettings } from '../api';
import type { AdminEvaluationSettings, AdminModelResponse } from '../types';
import { DEFAULT_RESPONSE_CORRECTION_SETTINGS } from '../evaluation-settings.types';

const defaults: AdminEvaluationSettings = {
  responseReliability: {
    enabled: false,
    mode: 'informative',
    judgeModelId: null,
    maxConcurrentEvaluations: 3,
    timeoutMs: 30_000,
    maxFindings: 5,
    correction: { ...DEFAULT_RESPONSE_CORRECTION_SETTINGS },
  },
};

export function EvaluationSettingsPage() {
  const { t } = useModuleTranslation('admin');
  const [settings, setSettings] = useState<AdminEvaluationSettings>(defaults);
  const [models, setModels] = useState<AdminModelResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getAdminEvaluationSettings(), getAllModels()])
      .then(([next, modelResponse]) => {
        const incoming = next as Partial<AdminEvaluationSettings>;
        setSettings({
          responseReliability: {
            ...defaults.responseReliability,
            ...incoming.responseReliability,
            correction: {
              ...DEFAULT_RESPONSE_CORRECTION_SETTINGS,
              ...incoming.responseReliability?.correction,
            },
          },
        });
        setModels(modelResponse.models);
      })
      .catch((error) => showError(t('evaluationSettings.toasts.loadError'), {
        description: error instanceof Error ? error.message : undefined,
      }))
      .finally(() => setLoading(false));
  }, [t]);

  const reliability = settings.responseReliability;
  const eligibleModels = models.filter((model) => model.isActive
    && (model.types.includes('chat') || model.types.includes('completion') || model.type === 'chat' || model.type === 'completion'));
  const selectedModelIsValid = !reliability.enabled
    || eligibleModels.some((model) => model.id === reliability.judgeModelId);
  const numericFieldsValid = Number.isInteger(reliability.maxConcurrentEvaluations)
    && reliability.maxConcurrentEvaluations >= 1 && reliability.maxConcurrentEvaluations <= 10
    && Number.isInteger(reliability.timeoutMs) && reliability.timeoutMs >= 5000 && reliability.timeoutMs <= 120000
    && Number.isInteger(reliability.maxFindings) && reliability.maxFindings >= 1 && reliability.maxFindings <= 10
    && Number.isInteger(reliability.correction.threshold) && reliability.correction.threshold >= 0 && reliability.correction.threshold <= 100
    && Number.isInteger(reliability.correction.maxAttempts) && reliability.correction.maxAttempts >= 1 && reliability.correction.maxAttempts <= 3
    && Number.isInteger(reliability.correction.maxDurationMs) && reliability.correction.maxDurationMs >= 10000;

  const patchReliability = (patch: Partial<typeof reliability>) => {
    setSettings((current) => ({
      responseReliability: { ...current.responseReliability, ...patch },
    }));
  };
  const patchCorrection = (patch: Partial<typeof reliability.correction>) => {
    setSettings((current) => ({
      responseReliability: {
        ...current.responseReliability,
        correction: { ...current.responseReliability.correction, ...patch },
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const normalized = await updateAdminEvaluationSettings(settings);
      setSettings({
        responseReliability: {
          ...defaults.responseReliability,
          ...normalized.responseReliability,
          correction: {
            ...DEFAULT_RESPONSE_CORRECTION_SETTINGS,
            ...normalized.responseReliability.correction,
          },
        },
      });
      showSuccess(t('evaluationSettings.toasts.saved'));
    } catch (error) {
      showError(t('evaluationSettings.toasts.saveError'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('evaluationSettings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('evaluationSettings.description')}</p>
      </div>

      <section className="space-y-4 rounded-lg border p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><Gauge className="h-4 w-4" /><Label htmlFor="answer-reliability-enabled">{t('evaluationSettings.enable')}</Label></div>
            <p className="text-sm text-muted-foreground">{t('evaluationSettings.enableDescription')}</p>
            <p className="text-xs text-muted-foreground">{t('evaluationSettings.scope')}</p>
          </div>
          <Switch id="answer-reliability-enabled" checked={reliability.enabled} onCheckedChange={(enabled) => patchReliability({ enabled })} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="font-semibold">{t('evaluationSettings.mode')}</h2>
        <RadioGroup value={reliability.mode} onValueChange={(mode) => patchReliability({ mode: mode as typeof reliability.mode })}>
          <ModeOption id="mode-informative" value="informative" title={t('evaluationSettings.informative')} description={t('evaluationSettings.informativeDescription')} />
          <ModeOption id="mode-corrective-transparent" value="corrective_transparent" title={t('evaluationSettings.correctiveTransparent')} description={t('evaluationSettings.correctiveTransparentDescription')} />
          <ModeOption id="mode-corrective-guarded" value="corrective_guarded" title={t('evaluationSettings.correctiveGuarded')} description={t('evaluationSettings.correctiveGuardedDescription')} badge={t('evaluationSettings.comingLater')} disabled />
        </RadioGroup>
      </section>

      <section className="space-y-3 rounded-lg border p-5">
        <Label htmlFor="answer-reliability-judge-model">{t('evaluationSettings.judgeModel')}</Label>
        <Select value={reliability.judgeModelId || undefined} onValueChange={(judgeModelId) => patchReliability({ judgeModelId })}>
          <SelectTrigger id="answer-reliability-judge-model" aria-label={t('evaluationSettings.judgeModel')}><SelectValue placeholder={t('evaluationSettings.selectModel')} /></SelectTrigger>
          <SelectContent>{eligibleModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent>
        </Select>
        {reliability.enabled && !selectedModelIsValid ? <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />{t('evaluationSettings.noModel')}</div> : null}
      </section>

      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="font-semibold">{t('evaluationSettings.advanced')}</h2>
        <NumberField id="answer-reliability-concurrency" label={t('evaluationSettings.concurrency')} description={t('evaluationSettings.concurrencyHelp')} value={reliability.maxConcurrentEvaluations} min={1} max={10} onChange={(value) => patchReliability({ maxConcurrentEvaluations: value })} />
        <NumberField id="answer-reliability-timeout" label={t('evaluationSettings.timeout')} description={t('evaluationSettings.timeoutHelp')} value={reliability.timeoutMs / 1000} min={5} max={120} onChange={(value) => patchReliability({ timeoutMs: value * 1000 })} />
        <NumberField id="answer-reliability-findings" label={t('evaluationSettings.maxFindings')} description={t('evaluationSettings.maxFindingsHelp')} value={reliability.maxFindings} min={1} max={10} onChange={(value) => patchReliability({ maxFindings: value })} />
      </section>

      {reliability.mode === 'corrective_transparent' ? (
        <section className="space-y-5 rounded-lg border p-5">
          <h2 className="font-semibold">{t('evaluationSettings.correction.title')}</h2>
          <NumberField id="correction-threshold" label={t('evaluationSettings.correction.threshold')} description={t('evaluationSettings.correction.thresholdHelp')} value={reliability.correction.threshold} min={0} max={100} onChange={(threshold) => patchCorrection({ threshold })} suffix="/100" />
          <NumberField id="correction-attempts" label={t('evaluationSettings.correction.maxAttempts')} description={reliability.correction.maxAttempts > 1 ? t('evaluationSettings.correction.attemptWarning') : t('evaluationSettings.correction.maxAttemptsHelp')} value={reliability.correction.maxAttempts} min={1} max={3} onChange={(maxAttempts) => patchCorrection({ maxAttempts })} />
          <NumberField id="correction-duration" label={t('evaluationSettings.correction.maxDuration')} description={t('evaluationSettings.correction.maxDurationHelp')} value={reliability.correction.maxDurationMs / 1000} min={10} onChange={(seconds) => patchCorrection({ maxDurationMs: seconds * 1000 })} />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t('evaluationSettings.correction.recovery')}</h3>
            <DisabledToggle id="correction-additional-retrieval" label={t('evaluationSettings.correction.additionalRetrieval')} badge={t('evaluationSettings.notAvailable')} />
            <DisabledToggle id="correction-connector-queries" label={t('evaluationSettings.correction.connectorQueries')} badge={t('evaluationSettings.notAvailable')} />
            <DisabledToggle id="correction-calculation-reruns" label={t('evaluationSettings.correction.calculationReruns')} badge={t('evaluationSettings.notAvailable')} />
          </div>

          <div className="space-y-3">
            <Label>{t('evaluationSettings.correction.failureBehavior')}</Label>
            <RadioGroup value={reliability.correction.failureBehavior} onValueChange={(failureBehavior) => patchCorrection({ failureBehavior: failureBehavior as typeof reliability.correction.failureBehavior })}>
              <ModeOption id="failure-publish" value="publish_with_warning" title={t('evaluationSettings.correction.publishWarning')} />
              <ModeOption id="failure-abstain" value="abstain" title={t('evaluationSettings.correction.abstain')} />
              <ModeOption id="failure-review" value="require_human_review" title={t('evaluationSettings.correction.humanReview')} />
            </RadioGroup>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div><Label htmlFor="show-original-answer">{t('evaluationSettings.correction.showOriginal')}</Label><p className="text-xs text-muted-foreground">{t('evaluationSettings.correction.showOriginalHelp')}</p></div>
            <Switch id="show-original-answer" checked={reliability.correction.showOriginalAnswer} onCheckedChange={(showOriginalAnswer) => patchCorrection({ showOriginalAnswer })} />
          </div>
        </section>
      ) : null}

      <div className="flex gap-2 rounded-lg border bg-muted/30 p-4 text-sm"><Info className="h-4 w-4 shrink-0" /><span>{t('evaluationSettings.fixedBehavior')}</span></div>
      <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={save} disabled={saving || !selectedModelIsValid || !numericFieldsValid}>{saving ? t('evaluationSettings.saving') : t('evaluationSettings.save')}</Button>
    </div>
  );
}

function NumberField({ id, label, description, value, min, max, onChange, suffix }: Readonly<{ id: string; label: string; description: string; value: number; min: number; max?: number; onChange: (value: number) => void; suffix?: string }>) {
  return <div className="grid gap-2 md:grid-cols-[1fr_10rem]"><div><Label htmlFor={id}>{label}</Label><p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p></div><div className="flex items-center gap-2"><Input id={id} name={id} aria-describedby={`${id}-description`} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />{suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}</div></div>;
}

function ModeOption({ id, value, title, description, badge, disabled }: Readonly<{ id: string; value: string; title: string; description?: string; badge?: string; disabled?: boolean }>) {
  return <div className="flex items-start gap-3 rounded-md border p-3"><RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" /><Label htmlFor={id} className={disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}><span className="flex items-center gap-2 font-medium">{title}{badge ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal">{badge}</span> : null}</span>{description ? <span className="mt-1 block text-xs font-normal text-muted-foreground">{description}</span> : null}</Label></div>;
}

function DisabledToggle({ id, label, badge }: Readonly<{ id: string; label: string; badge: string }>) {
  return <div className="flex items-center justify-between gap-3 rounded-md border p-3 opacity-60"><Label htmlFor={id}>{label}</Label><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{badge}</span><Switch id={id} name={id} aria-label={label} disabled checked={false} /></div></div>;
}
