import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminPlaybookSettings, getAllModels, updateAdminPlaybookSettings } from '../api';
import type { AdminModelResponse, AdminPlaybookSettings } from '../types';

const GLOBAL_DEFAULT_MODEL = '__global_default__';

const DEFAULT_INTENT_NORMALIZATION_LIMITS = {
  maxWorkflowPlanChanges: 500,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 24,
};

const LIMIT_FIELD_CONFIG = [
  { key: 'maxWorkflowPlanChanges', min: 1, max: 500 },
  { key: 'maxInputPorts', min: 1, max: 20 },
  { key: 'maxOutputPorts', min: 1, max: 20 },
  { key: 'maxIteratorBodySteps', min: 1, max: 50 },
  { key: 'maxIteratorBodyEdges', min: 1, max: 100 },
] as const;

type LimitFieldKey = (typeof LIMIT_FIELD_CONFIG)[number]['key'];

function buildSelectableModels(models: AdminModelResponse[], selectedModelId: string | null): AdminModelResponse[] {
  const activeModels = models.filter((model) => model.isActive);
  if (!selectedModelId) {
    return activeModels;
  }

  const selectedModel = models.find((model) => model.id === selectedModelId);
  if (!selectedModel || selectedModel.isActive) {
    return activeModels;
  }

  return [selectedModel, ...activeModels.filter((model) => model.id !== selectedModel.id)];
}

export function PlaybookSettingsPage() {
  const { t } = useModuleTranslation('admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<AdminModelResponse[]>([]);
  const [settings, setSettings] = useState<AdminPlaybookSettings>({
    inferenceModelId: null,
    advisorEvaluationModelId: null,
    replayEvaluationModelId: null,
    nodeSuggestionsMode: 'manual',
    approvalSuggestionMode: 'auto',
    intentNormalizationLimits: DEFAULT_INTENT_NORMALIZATION_LIMITS,
    replayEligibilityConfidenceThreshold: 70,
    useDeterministicBlueprintBuilder: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [settingsResult, modelsResult] = await Promise.all([
          getAdminPlaybookSettings(),
          getAllModels(),
        ]);

        if (cancelled) return;

        setSettings(settingsResult);
        setModels(modelsResult.models);
      } catch (error) {
        if (!cancelled) {
          showError(t('playbookSettings.toasts.loadError.title'), {
            description: error instanceof Error ? error.message : t('playbookSettings.toasts.loadError.description'),
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [t]);

  const selectedModelValue = settings.inferenceModelId || GLOBAL_DEFAULT_MODEL;
  const selectableInferenceModels = useMemo(
    () => buildSelectableModels(models, settings.inferenceModelId),
    [models, settings.inferenceModelId],
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.id === settings.inferenceModelId) || null,
    [models, settings.inferenceModelId],
  );
  const selectedAdvisorEvalModelValue = settings.advisorEvaluationModelId || GLOBAL_DEFAULT_MODEL;
  const selectableAdvisorModels = useMemo(
    () => buildSelectableModels(models, settings.advisorEvaluationModelId),
    [models, settings.advisorEvaluationModelId],
  );
  const selectedAdvisorEvalModel = useMemo(
    () => models.find((model) => model.id === settings.advisorEvaluationModelId) || null,
    [models, settings.advisorEvaluationModelId],
  );
  const selectedReplayEvalModelValue = settings.replayEvaluationModelId || GLOBAL_DEFAULT_MODEL;
  const selectableReplayModels = useMemo(
    () => buildSelectableModels(models, settings.replayEvaluationModelId),
    [models, settings.replayEvaluationModelId],
  );
  const selectedReplayEvalModel = useMemo(
    () => models.find((model) => model.id === settings.replayEvaluationModelId) || null,
    [models, settings.replayEvaluationModelId],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateAdminPlaybookSettings(settings);
      setSettings(result);
      showSuccess(t('playbookSettings.toasts.saved.title'), {
        description: t('playbookSettings.toasts.saved.description'),
      });
    } catch (error) {
      showError(t('playbookSettings.toasts.saveError.title'), {
        description: error instanceof Error ? error.message : t('playbookSettings.toasts.saveError.description'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLimitChange = (
    key: LimitFieldKey,
    value: string,
  ) => {
    const config = LIMIT_FIELD_CONFIG.find((item) => item.key === key);
    if (!config) return;

    const parsedValue = Number.parseInt(value, 10);
    const nextValue = Number.isFinite(parsedValue)
      ? Math.min(config.max, Math.max(config.min, parsedValue))
      : config.min;

    setSettings((prev) => ({
      ...prev,
      intentNormalizationLimits: {
        ...prev.intentNormalizationLimits,
        [key]: nextValue,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('playbookSettings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('playbookSettings.description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t('playbookSettings.inference.title')}
          </CardTitle>
          <CardDescription>{t('playbookSettings.inference.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('playbookSettings.loading')}</span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="playbook-model">{t('playbookSettings.fields.model.label')}</Label>
                <Select
                  value={selectedModelValue}
                  onValueChange={(value) => setSettings((prev) => ({
                    ...prev,
                    inferenceModelId: value === GLOBAL_DEFAULT_MODEL ? null : value,
                  }))}
                >
                  <SelectTrigger id="playbook-model">
                    <SelectValue placeholder={t('playbookSettings.fields.model.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GLOBAL_DEFAULT_MODEL}>{t('playbookSettings.fields.model.globalDefault')}</SelectItem>
                    {selectableInferenceModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                        {model.isActive ? '' : ` ${t('playbookSettings.fields.inactiveSuffix')}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedModel
                    ? selectedModel.isActive
                      ? t('playbookSettings.fields.model.selectedHelp', { model: selectedModel.name })
                      : t('playbookSettings.fields.model.inactiveHelp', { model: selectedModel.name })
                    : t('playbookSettings.fields.model.globalHelp')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="advisor-eval-model">{t('playbookSettings.fields.advisorEvalModel.label')}</Label>
                <Select
                  value={selectedAdvisorEvalModelValue}
                  onValueChange={(value) => setSettings((prev) => ({
                    ...prev,
                    advisorEvaluationModelId: value === GLOBAL_DEFAULT_MODEL ? null : value,
                  }))}
                >
                  <SelectTrigger id="advisor-eval-model">
                    <SelectValue placeholder={t('playbookSettings.fields.advisorEvalModel.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GLOBAL_DEFAULT_MODEL}>{t('playbookSettings.fields.advisorEvalModel.globalDefault')}</SelectItem>
                    {selectableAdvisorModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                        {model.isActive ? '' : ` ${t('playbookSettings.fields.inactiveSuffix')}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedAdvisorEvalModel
                    ? selectedAdvisorEvalModel.isActive
                      ? t('playbookSettings.fields.advisorEvalModel.selectedHelp', { model: selectedAdvisorEvalModel.name })
                      : t('playbookSettings.fields.advisorEvalModel.inactiveHelp', { model: selectedAdvisorEvalModel.name })
                    : t('playbookSettings.fields.advisorEvalModel.globalHelp')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="replay-eval-model">{t('playbookSettings.fields.replayEvalModel.label')}</Label>
                <Select
                  value={selectedReplayEvalModelValue}
                  onValueChange={(value) => setSettings((prev) => ({
                    ...prev,
                    replayEvaluationModelId: value === GLOBAL_DEFAULT_MODEL ? null : value,
                  }))}
                >
                  <SelectTrigger id="replay-eval-model">
                    <SelectValue placeholder={t('playbookSettings.fields.replayEvalModel.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GLOBAL_DEFAULT_MODEL}>{t('playbookSettings.fields.replayEvalModel.globalDefault')}</SelectItem>
                    {selectableReplayModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                        {model.isActive ? '' : ` ${t('playbookSettings.fields.inactiveSuffix')}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedReplayEvalModel
                    ? selectedReplayEvalModel.isActive
                      ? t('playbookSettings.fields.replayEvalModel.selectedHelp', { model: selectedReplayEvalModel.name })
                      : t('playbookSettings.fields.replayEvalModel.inactiveHelp', { model: selectedReplayEvalModel.name })
                    : t('playbookSettings.fields.replayEvalModel.globalHelp')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="node-suggestions-mode">{t('playbookSettings.fields.nodeSuggestionsMode.label')}</Label>
                <Select
                  value={settings.nodeSuggestionsMode}
                  onValueChange={(value: 'auto' | 'manual') => setSettings((prev) => ({ ...prev, nodeSuggestionsMode: value }))}
                >
                  <SelectTrigger id="node-suggestions-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">{t('playbookSettings.fields.nodeSuggestionsMode.manual')}</SelectItem>
                    <SelectItem value="auto">{t('playbookSettings.fields.nodeSuggestionsMode.auto')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="approval-suggestions-mode">{t('playbookSettings.fields.approvalSuggestionMode.label')}</Label>
                <Select
                  value={settings.approvalSuggestionMode}
                  onValueChange={(value: 'auto' | 'manual') => setSettings((prev) => ({ ...prev, approvalSuggestionMode: value }))}
                >
                  <SelectTrigger id="approval-suggestions-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('playbookSettings.fields.approvalSuggestionMode.auto')}</SelectItem>
                    <SelectItem value="manual">{t('playbookSettings.fields.approvalSuggestionMode.manual')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('playbookSettings.intentNormalization.title')}</CardTitle>
          <CardDescription>{t('playbookSettings.intentNormalization.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('playbookSettings.loading')}</span>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {LIMIT_FIELD_CONFIG.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key}>{t(`playbookSettings.fields.${field.key}.label`)}</Label>
                    <Input
                      id={field.key}
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={settings.intentNormalizationLimits[field.key]}
                      onChange={(event) => handleLimitChange(field.key, event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t(`playbookSettings.fields.${field.key}.help`, { min: field.min, max: field.max })}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('playbookSettings.replay.title')}</CardTitle>
          <CardDescription>{t('playbookSettings.replay.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('playbookSettings.loading')}</span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="replay-eligibility-threshold">{t('playbookSettings.fields.replayEligibilityThreshold.label')}</Label>
                <Input
                  id="replay-eligibility-threshold"
                  type="number"
                  min={0}
                  max={100}
                  value={settings.replayEligibilityConfidenceThreshold}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    const clamped = Number.isFinite(parsed)
                      ? Math.min(100, Math.max(0, parsed))
                      : 70;
                    setSettings((prev) => ({ ...prev, replayEligibilityConfidenceThreshold: clamped }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t('playbookSettings.fields.replayEligibilityThreshold.help')}
                </p>
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('playbookSettings.intent.title')}</CardTitle>
          <CardDescription>{t('playbookSettings.intent.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('playbookSettings.loading')}</span>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 p-4">
                <div className="space-y-1">
                  <Label htmlFor="use-deterministic-blueprint-builder">
                    {t('playbookSettings.fields.useDeterministicBlueprintBuilder.label')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('playbookSettings.fields.useDeterministicBlueprintBuilder.help')}
                  </p>
                </div>
                <Switch
                  id="use-deterministic-blueprint-builder"
                  checked={settings.useDeterministicBlueprintBuilder}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, useDeterministicBlueprintBuilder: checked === true }))
                  }
                />
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
