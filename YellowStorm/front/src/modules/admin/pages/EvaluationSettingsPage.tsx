import { useEffect, useState } from 'react';
import { AlertTriangle, Gauge, Info, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminEvaluationSettings, getAllModels, updateAdminEvaluationSettings } from '../api';
import type { AdminEvaluationSettings, AdminModelResponse } from '../types';

const defaults: AdminEvaluationSettings = {
  responseReliability: {
    enabled: false,
    mode: 'informative',
    judgeModelId: null,
    maxConcurrentEvaluations: 3,
    timeoutMs: 30_000,
    maxFindings: 5,
  },
};

export function EvaluationSettingsPage() {
  const { t } = useModuleTranslation('admin');
  const [settings, setSettings] = useState(defaults);
  const [models, setModels] = useState<AdminModelResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getAdminEvaluationSettings(), getAllModels()])
      .then(([next, modelResponse]) => {
        setSettings(next);
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
    && Number.isInteger(reliability.maxFindings) && reliability.maxFindings >= 1 && reliability.maxFindings <= 10;

  const patchReliability = (patch: Partial<typeof reliability>) => {
    setSettings((current) => ({
      responseReliability: { ...current.responseReliability, ...patch },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const normalized = await updateAdminEvaluationSettings(settings);
      setSettings(normalized);
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
            <div className="flex items-center gap-2"><Gauge className="h-4 w-4" /><Label htmlFor="answer-reliability-enabled">{t('evaluationSettings.enable')}</Label><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t('evaluationSettings.informative')}</span></div>
            <p className="text-sm text-muted-foreground">{t('evaluationSettings.informativeDescription')}</p>
            <p className="text-xs text-muted-foreground">{t('evaluationSettings.scope')}</p>
          </div>
          <Switch id="answer-reliability-enabled" checked={reliability.enabled} onCheckedChange={(enabled) => patchReliability({ enabled })} />
        </div>
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

      <div className="flex gap-2 rounded-lg border bg-muted/30 p-4 text-sm"><Info className="h-4 w-4 shrink-0" /><span>{t('evaluationSettings.fixedBehavior')}</span></div>
      <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={save} disabled={saving || !selectedModelIsValid || !numericFieldsValid}>{saving ? t('evaluationSettings.saving') : t('evaluationSettings.save')}</Button>
    </div>
  );
}

function NumberField({ id, label, description, value, min, max, onChange }: Readonly<{ id: string; label: string; description: string; value: number; min: number; max: number; onChange: (value: number) => void }>) {
  return <div className="grid gap-2 md:grid-cols-[1fr_10rem]"><div><Label htmlFor={id}>{label}</Label><p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p></div><Input id={id} name={id} aria-describedby={`${id}-description`} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></div>;
}
