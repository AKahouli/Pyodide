import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminPlaybookSettings, getAllModels, updateAdminPlaybookSettings } from '../api';
import type { AdminModelResponse, AdminPlaybookSettings } from '../types';

const GLOBAL_DEFAULT_MODEL = '__global_default__';

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
    nodeSuggestionsMode: 'manual',
    approvalSuggestionMode: 'auto',
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
    </div>
  );
}
