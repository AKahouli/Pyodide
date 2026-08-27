import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, HelpCircle, Loader2, Save, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminPlaybookSettings, getAllModels, getPlaybookPlannerAgents, getPlaybookSuggestorAgents, updateAdminPlaybookSettings } from '../api';
import type { AdminModelResponse, AdminPlaybookSettings, PlaybookPlannerAgentOption, PlaybookSuggestorAgentOption } from '../types';

const GLOBAL_DEFAULT_MODEL = '__global_default__';

const DEFAULT_INTENT_NORMALIZATION_LIMITS = {
  maxWorkflowPlanChanges: 500,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 24,
};

const DEFAULT_PLAYBOOK_EXECUTION_SETTINGS = {
  availableCapacity: 50,
  maxConcurrentPerUser: 10,
  maxConcurrentPerFlow: 5,
  maxConcurrentPerProvider: 25,
  maxConcurrentPerModel: 10,
  executionQueueMaxDepth: 50,
  maxParallelismPerExecution: 5,
  recursionLimitDefault: 25,
  recursionLimitMax: 50,
  maxHitlRounds: 5,
  pythonWorkerPoolSize: 8,
  pythonWorkerMaxInflight: 4,
  maxToolIterations: 40,
  graphCacheEnabled: false,
  graphCacheMaxEntries: 128,
  graphCacheTtlSeconds: 900,
  dynamicReasoning: { plannerAgentId: null, maxWorkNodes: 6, maxParallelism: 3, maxDepth: 1, maxRepairAttempts: 1 },
};

const EXECUTION_FIELD_KEYS = [
  'availableCapacity',
  'maxConcurrentPerUser',
  'maxConcurrentPerFlow',
  'maxConcurrentPerProvider',
  'maxConcurrentPerModel',
  'executionQueueMaxDepth',
  'maxParallelismPerExecution',
  'recursionLimitDefault',
  'recursionLimitMax',
  'maxHitlRounds',
  'pythonWorkerPoolSize',
  'pythonWorkerMaxInflight',
  'maxToolIterations',
  'graphCacheMaxEntries',
  'graphCacheTtlSeconds',
] as const;

const RUNTIME_TOOLTIP_KEYS = [
  'maxConcurrentPerUser', 'executionQueueMaxDepth', 'maxParallelismPerExecution',
  'recursionLimitDefault', 'recursionLimitMax', 'maxHitlRounds', 'pythonWorkerPoolSize',
  'pythonWorkerMaxInflight', 'maxToolIterations', 'graphCacheEnabled',
  'graphCacheMaxEntries', 'graphCacheTtlSeconds',
] as const;

type RuntimeTooltipKey = (typeof RUNTIME_TOOLTIP_KEYS)[number];

function hasRuntimeTooltip(key: string): key is RuntimeTooltipKey {
  return (RUNTIME_TOOLTIP_KEYS as readonly string[]).includes(key);
}

const EXECUTION_FIELD_MAX: Partial<Record<(typeof EXECUTION_FIELD_KEYS)[number], number>> = {
  maxHitlRounds: 100,
  pythonWorkerPoolSize: 100,
  pythonWorkerMaxInflight: 20,
  maxToolIterations: 500,
  graphCacheMaxEntries: 10000,
  graphCacheTtlSeconds: 86400,
};

const DYNAMIC_REASONING_FIELD_KEYS = ['maxWorkNodes', 'maxParallelism', 'maxDepth', 'maxRepairAttempts'] as const;

const LIMIT_FIELD_CONFIG = [
  { key: 'maxWorkflowPlanChanges', min: 1, max: 500 },
  { key: 'maxInputPorts', min: 1, max: 20 },
  { key: 'maxOutputPorts', min: 1, max: 20 },
  { key: 'maxIteratorBodySteps', min: 1, max: 50 },
  { key: 'maxIteratorBodyEdges', min: 1, max: 100 },
] as const;

type LimitFieldKey = (typeof LIMIT_FIELD_CONFIG)[number]['key'];

type SettingsPaneProps = Readonly<{
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}>;

function SettingsPane({ title, description, icon, contentClassName = 'space-y-6', children }: SettingsPaneProps) {
  return (
    <Collapsible defaultOpen={false}>
      <Card>
        <CollapsibleTrigger asChild>
          <button type="button" className="group w-full text-left">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    {icon}
                    {title}
                  </CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
                <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </div>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className={contentClassName}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function FieldLabel({ fieldKey, children }: Readonly<{ fieldKey: string; children: ReactNode }>) {
  const { t } = useModuleTranslation('admin');
  return (
    <span className="flex items-center gap-1.5">
      {children}
      {hasRuntimeTooltip(fieldKey) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={t(`playbookSettings.execution.fields.${fieldKey}.tooltipLabel`)}>
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{t(`playbookSettings.execution.fields.${fieldKey}.tooltip`)}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [models, setModels] = useState<AdminModelResponse[]>([]);
  const [plannerAgents, setPlannerAgents] = useState<PlaybookPlannerAgentOption[]>([]);
  const [suggestorAgents, setSuggestorAgents] = useState<PlaybookSuggestorAgentOption[]>([]);
  const [settings, setSettings] = useState<AdminPlaybookSettings>({
    playbookSuggestorAgentId: null,
    inferenceModelId: null,
    advisorEvaluationModelId: null,
    replayEvaluationModelId: null,
    nodeSuggestionsMode: 'manual',
    approvalSuggestionMode: 'auto',
    intentNormalizationLimits: DEFAULT_INTENT_NORMALIZATION_LIMITS,
    replayEligibilityConfidenceThreshold: 70,
    useDeterministicBlueprintBuilder: true,
    playbookExecution: DEFAULT_PLAYBOOK_EXECUTION_SETTINGS,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [settingsResult, modelsResult, plannerAgentsResult, suggestorAgentsResult] = await Promise.all([
          getAdminPlaybookSettings(),
          getAllModels(),
          getPlaybookPlannerAgents(),
          getPlaybookSuggestorAgents(),
        ]);

        if (cancelled) return;

        setSettings({
          ...settingsResult,
          playbookExecution: {
            ...DEFAULT_PLAYBOOK_EXECUTION_SETTINGS,
            ...(settingsResult.playbookExecution ?? {}),
            dynamicReasoning: {
              ...DEFAULT_PLAYBOOK_EXECUTION_SETTINGS.dynamicReasoning,
              ...(settingsResult.playbookExecution?.dynamicReasoning ?? {}),
            },
          },
        });
        setModels(modelsResult.models);
        setPlannerAgents(plannerAgentsResult);
        setSuggestorAgents(suggestorAgentsResult);
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
  const selectedPlannerAgent = useMemo(
    () => plannerAgents.find((agent) => agent.id === settings.playbookExecution.dynamicReasoning.plannerAgentId) || null,
    [plannerAgents, settings.playbookExecution.dynamicReasoning.plannerAgentId],
  );
  const selectedSuggestorAgent = useMemo(
    () => suggestorAgents.find((agent) => agent.id === settings.playbookSuggestorAgentId) || null,
    [settings.playbookSuggestorAgentId, suggestorAgents],
  );

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await updateAdminPlaybookSettings(settings);
      setSettings(result);
      showSuccess(t('playbookSettings.toasts.saved.title'), {
        description: t('playbookSettings.toasts.saved.description'),
      });
    } catch (error) {
      const message = parseApiError(error).message;
      setSaveError(message);
      showError(t('playbookSettings.toasts.saveError.title'), {
        description: message,
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

  const executionSettingsValid = settings.playbookExecution.maxConcurrentPerUser <= settings.playbookExecution.availableCapacity
    && settings.playbookExecution.maxConcurrentPerFlow <= settings.playbookExecution.availableCapacity
    && settings.playbookExecution.maxConcurrentPerProvider <= settings.playbookExecution.availableCapacity
    && settings.playbookExecution.maxConcurrentPerModel <= settings.playbookExecution.availableCapacity
    && settings.playbookExecution.recursionLimitDefault <= settings.playbookExecution.recursionLimitMax
    && settings.playbookExecution.dynamicReasoning.maxParallelism <= settings.playbookExecution.dynamicReasoning.maxWorkNodes
    && settings.playbookExecution.dynamicReasoning.maxParallelism <= settings.playbookExecution.maxParallelismPerExecution
    && settings.playbookExecution.dynamicReasoning.maxDepth === 1
    && selectedPlannerAgent !== null;
  const settingsValid = executionSettingsValid && selectedSuggestorAgent !== null;

  const updateExecutionField = (key: (typeof EXECUTION_FIELD_KEYS)[number], value: string) => {
    const parsed = Number.parseInt(value, 10);
    setSettings((previous) => ({
      ...previous,
      playbookExecution: {
        ...previous.playbookExecution,
        [key]: Number.isFinite(parsed) ? Math.max(key === 'executionQueueMaxDepth' ? 0 : 1, parsed) : 1,
      },
    }));
  };

  const updateDynamicReasoningField = (key: (typeof DYNAMIC_REASONING_FIELD_KEYS)[number], value: string) => {
    const parsed = Number.parseInt(value, 10);
    setSettings((previous) => ({
      ...previous,
      playbookExecution: {
        ...previous.playbookExecution,
        dynamicReasoning: {
          ...previous.playbookExecution.dynamicReasoning,
          [key]: Number.isFinite(parsed) ? Math.max(key === 'maxRepairAttempts' ? 0 : 1, parsed) : 1,
        },
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('playbookSettings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('playbookSettings.description')}</p>
      </div>

      {saveError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">{t('playbookSettings.toasts.saveError.title')}</p>
          <p>{saveError}</p>
        </div>
      )}

      <SettingsPane
        title={t('playbookSettings.suggestor.title')}
        description={t('playbookSettings.suggestor.description')}
        icon={<Wand2 className="h-4 w-4" />}
        contentClassName="space-y-4"
      >
          <div className="space-y-2">
            <Label htmlFor="playbook-suggestor-agent">{t('playbookSettings.suggestor.agent.label')}</Label>
            <Select
              value={settings.playbookSuggestorAgentId ?? ''}
              onValueChange={(playbookSuggestorAgentId) => setSettings((previous) => ({
                ...previous,
                playbookSuggestorAgentId,
              }))}
              disabled={loading || suggestorAgents.length === 0}
            >
              <SelectTrigger id="playbook-suggestor-agent">
                <SelectValue placeholder={t('playbookSettings.suggestor.agent.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {settings.playbookSuggestorAgentId && !selectedSuggestorAgent && (
                  <SelectItem value={settings.playbookSuggestorAgentId} disabled>
                    {t('playbookSettings.suggestor.agent.unavailable')}
                  </SelectItem>
                )}
                {suggestorAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>{agent.name} · {agent.model}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className={selectedSuggestorAgent ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
              {selectedSuggestorAgent
                ? t('playbookSettings.suggestor.agent.selectedHelp', {
                  agent: selectedSuggestorAgent.name,
                  model: selectedSuggestorAgent.model,
                })
                : suggestorAgents.length === 0
                  ? t('playbookSettings.suggestor.agent.noOptions')
                  : t('playbookSettings.suggestor.agent.required')}
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => void handleSave()} disabled={saving || !settingsValid}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t('playbookSettings.actions.save')}
            </Button>
          </div>
      </SettingsPane>

      <SettingsPane
        title={t('playbookSettings.execution.title')}
        description={t('playbookSettings.execution.description')}
      >
        <TooltipProvider>
          <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {EXECUTION_FIELD_KEYS.map((key) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`execution-${key}`}><FieldLabel fieldKey={key}>{t(`playbookSettings.execution.fields.${key}.label`)}</FieldLabel></Label>
                <Input
                  id={`execution-${key}`}
                  type="number"
                  min={key === 'executionQueueMaxDepth' ? 0 : 1}
                  max={EXECUTION_FIELD_MAX[key]}
                  value={settings.playbookExecution[key]}
                  onChange={(event) => updateExecutionField(key, event.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 p-4">
            <Label htmlFor="execution-graphCacheEnabled">
              <FieldLabel fieldKey="graphCacheEnabled">{t('playbookSettings.execution.fields.graphCacheEnabled.label')}</FieldLabel>
            </Label>
            <Switch
              id="execution-graphCacheEnabled"
              checked={settings.playbookExecution.graphCacheEnabled}
              onCheckedChange={(graphCacheEnabled) => setSettings((previous) => ({
                ...previous,
                playbookExecution: { ...previous.playbookExecution, graphCacheEnabled },
              }))}
            />
          </div>
          <div className="space-y-3 rounded-md border border-border/60 p-4">
            <div>
              <h3 className="text-sm font-semibold">{t('playbookSettings.execution.dynamicReasoning.title')}</h3>
              <p className="text-xs text-muted-foreground">{t('playbookSettings.execution.dynamicReasoning.description')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dynamic-planner-agent">{t('playbookSettings.execution.dynamicReasoning.planner.label')}</Label>
              <Select
                value={settings.playbookExecution.dynamicReasoning.plannerAgentId ?? ''}
                onValueChange={(plannerAgentId) => setSettings((previous) => ({
                  ...previous,
                  playbookExecution: {
                    ...previous.playbookExecution,
                    dynamicReasoning: {
                      ...previous.playbookExecution.dynamicReasoning,
                      plannerAgentId,
                    },
                  },
                }))}
                disabled={loading || plannerAgents.length === 0}
              >
                <SelectTrigger id="dynamic-planner-agent">
                  <SelectValue placeholder={t('playbookSettings.execution.dynamicReasoning.planner.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {settings.playbookExecution.dynamicReasoning.plannerAgentId && !selectedPlannerAgent && (
                    <SelectItem value={settings.playbookExecution.dynamicReasoning.plannerAgentId} disabled>
                      {t('playbookSettings.execution.dynamicReasoning.planner.unavailable')}
                    </SelectItem>
                  )}
                  {plannerAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} · {agent.model || t('playbookSettings.execution.dynamicReasoning.planner.inferenceFallback')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className={selectedPlannerAgent ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
                {selectedPlannerAgent
                  ? t('playbookSettings.execution.dynamicReasoning.planner.selectedHelp', {
                    agent: selectedPlannerAgent.name,
                    model: selectedPlannerAgent.model || t('playbookSettings.execution.dynamicReasoning.planner.inferenceFallback'),
                  })
                  : plannerAgents.length === 0
                    ? t('playbookSettings.execution.dynamicReasoning.planner.noOptions')
                    : t('playbookSettings.execution.dynamicReasoning.planner.required')}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {DYNAMIC_REASONING_FIELD_KEYS.map((key) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`dynamic-${key}`}>{t(`playbookSettings.execution.dynamicReasoning.fields.${key}`)}</Label>
                  <Input
                    id={`dynamic-${key}`}
                    type="number"
                    min={key === 'maxRepairAttempts' ? 0 : 1}
                    max={key === 'maxDepth' ? 1 : undefined}
                    value={settings.playbookExecution.dynamicReasoning[key]}
                    onChange={(event) => updateDynamicReasoningField(key, event.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
          {!executionSettingsValid && <p className="text-sm text-destructive">{t('playbookSettings.execution.validationError')}</p>}
          <p className="text-xs text-muted-foreground">{t('playbookSettings.execution.newExecutionsOnly')}</p>
          <div className="flex justify-end">
            <Button type="button" onClick={() => void handleSave()} disabled={saving || !settingsValid}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t('playbookSettings.actions.save')}
            </Button>
          </div>
          </div>
        </TooltipProvider>
      </SettingsPane>

      <SettingsPane
        title={t('playbookSettings.inference.title')}
        description={t('playbookSettings.inference.description')}
        icon={<Sparkles className="h-4 w-4" />}
      >
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
                <Button type="button" onClick={() => void handleSave()} disabled={saving || !settingsValid}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
      </SettingsPane>

      <SettingsPane
        title={t('playbookSettings.intentNormalization.title')}
        description={t('playbookSettings.intentNormalization.description')}
      >
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
                <Button type="button" onClick={() => void handleSave()} disabled={saving || !settingsValid}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
      </SettingsPane>

      <SettingsPane
        title={t('playbookSettings.replay.title')}
        description={t('playbookSettings.replay.description')}
      >
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
                <Button type="button" onClick={() => void handleSave()} disabled={saving || !settingsValid}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
      </SettingsPane>

      <SettingsPane
        title={t('playbookSettings.intent.title')}
        description={t('playbookSettings.intent.description')}
      >
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
                <Button type="button" onClick={() => void handleSave()} disabled={saving || !settingsValid}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('playbookSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
      </SettingsPane>
    </div>
  );
}
