import { useEffect, useMemo, useState } from 'react';
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
import type { AdminModelResponse } from '../types';
import {
  DEFAULT_RESPONSE_CORRECTION_SETTINGS,
  type AdminEvaluationSettingsV2,
  type CorrectionFailureBehavior,
  type EvaluationMode,
} from '../evaluation-settings.types';

const defaults: AdminEvaluationSettingsV2 = {
  responseReliability: {
    enabled: false,
    mode: 'informative',
    judgeModelId: null,
    maxConcurrentEvaluations: 3,
    timeoutMs: 30_000,
    maxFindings: 5,
    correction: DEFAULT_RESPONSE_CORRECTION_SETTINGS,
  },
};

export function EvaluationSettingsPage() {
  const { t, language } = useModuleTranslation('admin');
  const copy = useMemo(() => getCopy(language === 'fr'), [language]);
  const [settings, setSettings] = useState<AdminEvaluationSettingsV2>(defaults);
  const [models, setModels] = useState<AdminModelResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getAdminEvaluationSettings(), getAllModels()])
      .then(([next, modelResponse]) => {
        const incoming = next as unknown as Partial<AdminEvaluationSettingsV2>;
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
  const correction = reliability.correction;
  const eligibleModels = models.filter((model) => model.isActive
    && (model.types.includes('chat') || model.types.includes('completion') || model.type === 'chat' || model.type === 'completion'));
  const selectedModelIsValid = !reliability.enabled
    || eligibleModels.some((model) => model.id === reliability.judgeModelId);
  const numericFieldsValid = Number.isInteger(reliability.maxConcurrentEvaluations)
    && reliability.maxConcurrentEvaluations >= 1 && reliability.maxConcurrentEvaluations <= 10
    && Number.isInteger(reliability.timeoutMs) && reliability.timeoutMs >= 5000 && reliability.timeoutMs <= 120000
    && Number.isInteger(reliability.maxFindings) && reliability.maxFindings >= 1 && reliability.maxFindings <= 10
    && Number.isInteger(correction.threshold) && correction.threshold >= 0 && correction.threshold <= 100
    && Number.isInteger(correction.maxAttempts) && correction.maxAttempts >= 1 && correction.maxAttempts <= 3
    && Number.isInteger(correction.maxDurationMs) && correction.maxDurationMs >= 10000 && correction.maxDurationMs <= 300000;

  const patchReliability = (patch: Partial<typeof reliability>) => {
    setSettings((current) => ({
      responseReliability: { ...current.responseReliability, ...patch },
    }));
  };

  const patchCorrection = (patch: Partial<typeof correction>) => {
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
      const normalized = await updateAdminEvaluationSettings(settings as never) as unknown as AdminEvaluationSettingsV2;
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
            <p className="text-sm text-muted-foreground">{copy.enableDescription}</p>
            <p className="text-xs text-muted-foreground">{t('evaluationSettings.scope')}</p>
          </div>
          <Switch id="answer-reliability-enabled" checked={reliability.enabled} onCheckedChange={(enabled) => patchReliability({ enabled })} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-5">
        <div><h2 className="font-semibold">{copy.modeTitle}</h2><p className="text-sm text-muted-foreground">{copy.modeHelp}</p></div>
        <RadioGroup value={reliability.mode} onValueChange={(value) => patchReliability({ mode: value as EvaluationMode })}>
          <ModeOption value="informative" title={copy.informative} description={copy.informativeHelp} />
          <ModeOption value="corrective_transparent" title={copy.transparent} description={copy.transparentHelp} />
          <ModeOption value="corrective_guarded" title={copy.guarded} description={copy.guardedHelp} disabled badge={copy.comingLater} />
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

      {reliability.mode === 'corrective_transparent' ? (
        <section className="space-y-4 rounded-lg border p-5">
          <div><h2 className="font-semibold">{copy.correctiveSettings}</h2><p className="text-sm text-muted-foreground">{copy.configurationOnly}</p></div>
          <NumberField id="correction-threshold" label={copy.threshold} description={copy.thresholdHelp} value={correction.threshold} min={0} max={100} suffix="/100" onChange={(threshold) => patchCorrection({ threshold })} />
          <NumberField id="correction-attempts" label={copy.maxAttempts} description={copy.maxAttemptsHelp} value={correction.maxAttempts} min={1} max={3} onChange={(maxAttempts) => patchCorrection({ maxAttempts })} />
          <NumberField id="correction-duration" label={copy.maxDuration} description={copy.maxDurationHelp} value={correction.maxDurationMs / 1000} min={10} max={300} suffix={copy.seconds} onChange={(value) => patchCorrection({ maxDurationMs: value * 1000 })} />
          <ToggleField label={copy.documentRetrieval} description={copy.documentRetrievalHelp} checked={correction.allowAdditionalDocumentRetrieval} onChange={(allowAdditionalDocumentRetrieval) => patchCorrection({ allowAdditionalDocumentRetrieval })} />
          <ToggleField label={copy.connectorQueries} description={copy.connectorQueriesHelp} checked={correction.allowConnectorQueries} onChange={(allowConnectorQueries) => patchCorrection({ allowConnectorQueries })} />
          <ToggleField label={copy.calculationReruns} description={copy.calculationRerunsHelp} checked={correction.allowCalculationReruns} onChange={(allowCalculationReruns) => patchCorrection({ allowCalculationReruns })} />
          <div className="space-y-2"><Label>{copy.failureBehavior}</Label><RadioGroup value={correction.failureBehavior} onValueChange={(value) => patchCorrection({ failureBehavior: value as CorrectionFailureBehavior })}><ModeOption value="publish_with_warning" title={copy.publishWarning} description={copy.publishWarningHelp} /><ModeOption value="abstain" title={copy.abstain} description={copy.abstainHelp} /><ModeOption value="require_human_review" title={copy.humanReview} description={copy.humanReviewHelp} /></RadioGroup></div>
          <ToggleField label={copy.showOriginal} description={copy.showOriginalHelp} checked={correction.showOriginalAnswer} onChange={(showOriginalAnswer) => patchCorrection({ showOriginalAnswer })} />
        </section>
      ) : null}

      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="font-semibold">{t('evaluationSettings.advanced')}</h2>
        <NumberField id="answer-reliability-concurrency" label={t('evaluationSettings.concurrency')} description={t('evaluationSettings.concurrencyHelp')} value={reliability.maxConcurrentEvaluations} min={1} max={10} onChange={(value) => patchReliability({ maxConcurrentEvaluations: value })} />
        <NumberField id="answer-reliability-timeout" label={t('evaluationSettings.timeout')} description={t('evaluationSettings.timeoutHelp')} value={reliability.timeoutMs / 1000} min={5} max={120} onChange={(value) => patchReliability({ timeoutMs: value * 1000 })} />
        <NumberField id="answer-reliability-findings" label={t('evaluationSettings.maxFindings')} description={t('evaluationSettings.maxFindingsHelp')} value={reliability.maxFindings} min={1} max={10} onChange={(value) => patchReliability({ maxFindings: value })} />
      </section>

      <div className="flex gap-2 rounded-lg border bg-muted/30 p-4 text-sm"><Info className="h-4 w-4 shrink-0" /><span>{copy.runtimeNotice}</span></div>
      <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={save} disabled={saving || !selectedModelIsValid || !numericFieldsValid}>{saving ? t('evaluationSettings.saving') : t('evaluationSettings.save')}</Button>
    </div>
  );
}

function ModeOption({ value, title, description, disabled = false, badge }: Readonly<{ value: string; title: string; description: string; disabled?: boolean; badge?: string }>) {
  return <Label className={`flex items-start gap-3 rounded-lg border p-4 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}><RadioGroupItem value={value} disabled={disabled} className="mt-1" /><span className="space-y-1"><span className="flex items-center gap-2 font-medium">{title}{badge ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{badge}</span> : null}</span><span className="block text-sm font-normal text-muted-foreground">{description}</span></span></Label>;
}

function ToggleField({ label, description, checked, onChange }: Readonly<{ label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }>) {
  return <div className="flex items-center justify-between gap-4 rounded-md border p-3"><div><Label>{label}</Label><p className="text-xs text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

function NumberField({ id, label, description, value, min, max, suffix, onChange }: Readonly<{ id: string; label: string; description: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }>) {
  return <div className="grid gap-2 md:grid-cols-[1fr_10rem]"><div><Label htmlFor={id}>{label}</Label><p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p></div><div className="flex items-center gap-2"><Input id={id} name={id} aria-describedby={`${id}-description`} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />{suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}</div></div>;
}

function getCopy(fr: boolean) {
  return fr ? {
    enableDescription: "Choisissez un mode d'évaluation pour les réponses terminées.", modeTitle: 'Mode', modeHelp: "Définit si l'évaluation reste informative ou prépare une correction transparente.", informative: 'Informatif', informativeHelp: "Affiche la réponse puis son niveau de fiabilité, sans modification.", transparent: 'Correctif — transparent', transparentHelp: "Affiche la réponse immédiatement et enregistre les paramètres du futur workflow correctif.", guarded: 'Correctif — contrôlé', guardedHelp: 'Vérifier et corriger avant publication.', comingLater: 'À venir', correctiveSettings: 'Paramètres correctifs', configurationOnly: "Ces paramètres sont enregistrés maintenant. Le moteur correctif sera activé dans une étape ultérieure.", threshold: 'Seuil de correction', thresholdHelp: 'Déclencher la correction sous ce score.', maxAttempts: 'Nombre maximal de tentatives', maxAttemptsHelp: 'Nombre maximal de cycles correction/réévaluation.', maxDuration: 'Durée maximale de correction', maxDurationHelp: 'Budget total du futur workflow correctif.', seconds: 's', documentRetrieval: 'Autoriser une recherche documentaire supplémentaire', documentRetrievalHelp: 'Permettre la recherche de preuves supplémentaires dans les documents autorisés.', connectorQueries: 'Autoriser les requêtes vers les connecteurs', connectorQueriesHelp: 'Permettre des requêtes de lecture vers les connecteurs autorisés.', calculationReruns: 'Autoriser la relance des calculs', calculationRerunsHelp: 'Permettre la réexécution des calculs persistés.', failureBehavior: "Comportement en cas d'échec", publishWarning: 'Publier avec un avertissement', publishWarningHelp: 'Conserver la réponse originale avec un avertissement.', abstain: "S'abstenir", abstainHelp: "Afficher qu'une réponse suffisamment étayée n'a pas pu être produite.", humanReview: 'Exiger une revue humaine', humanReviewHelp: 'Marquer la réponse comme provisoire et demander une revue.', showOriginal: 'Afficher la réponse originale', showOriginalHelp: "Permettre aux utilisateurs de consulter la réponse originale après correction.", runtimeNotice: "Pour l'instant, le mode correctif transparent enregistre uniquement sa configuration. L'exécution reste informative jusqu'à l'ajout du workflow correctif." } : {
    enableDescription: 'Choose how completed answers are evaluated.', modeTitle: 'Mode', modeHelp: 'Choose whether evaluation remains informative or is configured for transparent correction.', informative: 'Informative', informativeHelp: 'Show the answer and its reliability result without changing it.', transparent: 'Corrective — transparent', transparentHelp: 'Show the answer immediately and save settings for the upcoming corrective workflow.', guarded: 'Corrective — guarded', guardedHelp: 'Verify and correct before publication.', comingLater: 'Coming later', correctiveSettings: 'Corrective settings', configurationOnly: 'These settings are stored now. The correction engine will be enabled in a later implementation step.', threshold: 'Correction threshold', thresholdHelp: 'Start correction when the reliability score is below this value.', maxAttempts: 'Maximum correction attempts', maxAttemptsHelp: 'Maximum correction and re-evaluation cycles.', maxDuration: 'Maximum correction duration', maxDurationHelp: 'Total time budget for the future correction workflow.', seconds: 'sec', documentRetrieval: 'Allow additional document retrieval', documentRetrievalHelp: 'Allow additional evidence retrieval from authorized documents.', connectorQueries: 'Allow connector queries', connectorQueriesHelp: 'Allow read-only evidence queries through approved connectors.', calculationReruns: 'Allow calculation reruns', calculationRerunsHelp: 'Allow persisted calculations to be executed again.', failureBehavior: 'Behavior when correction fails', publishWarning: 'Publish with warning', publishWarningHelp: 'Keep the original answer visible with a warning.', abstain: 'Abstain', abstainHelp: 'State that a sufficiently supported answer could not be produced.', humanReview: 'Require human review', humanReviewHelp: 'Mark the answer provisional and request review.', showOriginal: 'Show original answer', showOriginalHelp: 'Allow users to view the original answer after correction.', runtimeNotice: 'For now, Corrective — transparent stores configuration only. Runtime behavior remains informative until the correction workflow is implemented.' };
}
