import { useEffect, useState } from 'react';
import { Gauge, Loader2, MessageSquare, Save, Sparkles, Tag } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import {
  getAdminConversationSettings,
  getAdminConversationSettingsAgents,
  getAllModels,
  updateAdminConversationSettings,
} from '../api';
import type { AdminModelResponse, ComposerSuggestionSettings, ConversationSettingsAgentOption } from '../types';

const PLATFORM_DEFAULT = 'platform-default';

const DEFAULTS: ComposerSuggestionSettings = {
  enabled: true,
  agentId: null,
  debounceMs: 400,
  minimumDraftLength: 3,
  requestsPerMinute: 60,
  maxOutputTokens: 256,
};

const LATENCY_DEFAULT = true;

const LIMITS = {
  debounceMs: [250, 2000],
  minimumDraftLength: [3, 200],
  requestsPerMinute: [1, 120],
  maxOutputTokens: [32, 1024],
} as const;

export function ConversationSettingsPage() {
  const { t } = useModuleTranslation('admin');
  const [settings, setSettings] = useState<ComposerSuggestionSettings>(DEFAULTS);
  const [latencyInstrumentationEnabled, setLatencyInstrumentationEnabled] = useState(LATENCY_DEFAULT);
  const [nameModelId, setNameModelId] = useState<string | null>(null);
  const [models, setModels] = useState<AdminModelResponse[]>([]);
  const [agents, setAgents] = useState<ConversationSettingsAgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAdminConversationSettings(), getAdminConversationSettingsAgents(), getAllModels()])
      .then(([result, agentOptions, modelList]) => {
        if (cancelled) return;
        setSettings(result.composerSuggestions);
        setLatencyInstrumentationEnabled(result.latencyInstrumentationEnabled ?? LATENCY_DEFAULT);
        setNameModelId(result.conversationName?.modelId ?? null);
        setAgents(agentOptions);
        setModels(modelList.models.filter((model) => model.isActive));
      })
      .catch((error) => {
        if (!cancelled) showError(t('conversationSettings.toasts.loadError'), { description: error instanceof Error ? error.message : undefined });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const setNumber = (key: keyof typeof LIMITS, value: string): void => {
    setSettings((current) => ({ ...current, [key]: Number(value) }));
    setValidationError(false);
  };

  const selectedAgent = agents.find((agent) => agent.id === settings.agentId);
  const isValid = Object.entries(LIMITS).every(([key, [minimum, maximum]]) => {
    const value = settings[key as keyof typeof LIMITS];
    return Number.isInteger(value) && value >= minimum && value <= maximum;
  });

  const save = async (): Promise<void> => {
    if (!isValid) {
      setValidationError(true);
      return;
    }
    setSaving(true);
    try {
      const result = await updateAdminConversationSettings({
        composerSuggestions: settings,
        conversationName: { modelId: nameModelId },
        latencyInstrumentationEnabled,
      });
      setSettings(result.composerSuggestions);
      setLatencyInstrumentationEnabled(result.latencyInstrumentationEnabled ?? LATENCY_DEFAULT);
      setNameModelId(result.conversationName?.modelId ?? null);
      showSuccess(t('conversationSettings.toasts.saved.title'), { description: t('conversationSettings.toasts.saved.description') });
    } catch (error) {
      showError(t('conversationSettings.toasts.saveError'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MessageSquare className="h-6 w-6" />
          {t('conversationSettings.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('conversationSettings.description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4" />{t('conversationSettings.latency.title')}</CardTitle>
          <CardDescription>{t('conversationSettings.latency.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('conversationSettings.loading')}</div>
          ) : (
            <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="latency-instrumentation-enabled">{t('conversationSettings.latency.enabled.label')}</Label>
                <p className="text-xs text-muted-foreground">{t('conversationSettings.latency.enabled.description')}</p>
              </div>
              <Switch
                id="latency-instrumentation-enabled"
                checked={latencyInstrumentationEnabled}
                onCheckedChange={setLatencyInstrumentationEnabled}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Tag className="h-4 w-4" />{t('conversationSettings.naming.title')}</CardTitle>
          <CardDescription>{t('conversationSettings.naming.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('conversationSettings.loading')}</div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="naming-model">{t('conversationSettings.naming.model.label')}</Label>
              <Select value={nameModelId ?? PLATFORM_DEFAULT} onValueChange={(value) => setNameModelId(value === PLATFORM_DEFAULT ? null : value)}>
                <SelectTrigger id="naming-model" aria-describedby="naming-model-help"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-[40vh]">
                  <SelectItem value={PLATFORM_DEFAULT}>{t('conversationSettings.naming.model.platformDefault')}</SelectItem>
                  {models.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}{model.chef ? ` - ${model.chef}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              <p id="naming-model-help" className="text-xs text-muted-foreground">{t('conversationSettings.naming.model.description')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('conversationSettings.suggestions.title')}</CardTitle>
          <CardDescription>{t('conversationSettings.suggestions.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('conversationSettings.loading')}</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
                <div className="space-y-1">
                  <Label htmlFor="suggestions-enabled">{t('conversationSettings.enabled.label')}</Label>
                  <p className="text-xs text-muted-foreground">{t('conversationSettings.enabled.description')}</p>
                </div>
                <Switch id="suggestions-enabled" checked={settings.enabled} onCheckedChange={(enabled) => setSettings((current) => ({ ...current, enabled }))} />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="suggestion-agent">{t('conversationSettings.agent.label')}</Label>
                  <Select value={settings.agentId ?? 'automatic'} onValueChange={(value) => setSettings((current) => ({ ...current, agentId: value === 'automatic' ? null : value }))} disabled={!settings.enabled}>
                    <SelectTrigger id="suggestion-agent" aria-describedby="suggestion-agent-help"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automatic">{t('conversationSettings.agent.automatic')}</SelectItem>
                      {agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}{agent.agentTypeName ? ` - ${agent.agentTypeName}` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p id="suggestion-agent-help" className="text-xs text-muted-foreground">{t('conversationSettings.agent.description')}</p>
                  {selectedAgent && <p className="text-xs text-muted-foreground">{t('conversationSettings.agent.resolved', { name: selectedAgent.name, model: selectedAgent.model ?? t('conversationSettings.agent.defaultModel') })}</p>}
                </div>

                <NumberSetting id="suggestion-debounce" label={t('conversationSettings.debounce.label')} description={t('conversationSettings.debounce.description')} value={settings.debounceMs} min={250} max={2000} disabled={!settings.enabled} onChange={(value) => setNumber('debounceMs', value)} />
                <NumberSetting id="suggestion-minimum" label={t('conversationSettings.minimumLength.label')} description={t('conversationSettings.minimumLength.description')} value={settings.minimumDraftLength} min={3} max={200} disabled={!settings.enabled} onChange={(value) => setNumber('minimumDraftLength', value)} />
                <NumberSetting id="suggestion-rate" label={t('conversationSettings.rateLimit.label')} description={t('conversationSettings.rateLimit.description')} value={settings.requestsPerMinute} min={1} max={120} disabled={!settings.enabled} onChange={(value) => setNumber('requestsPerMinute', value)} />
                <NumberSetting id="suggestion-tokens" label={t('conversationSettings.maxTokens.label')} description={t('conversationSettings.maxTokens.description')} value={settings.maxOutputTokens} min={32} max={1024} disabled={!settings.enabled} onChange={(value) => setNumber('maxOutputTokens', value)} />
              </div>

              {validationError && <Alert variant="destructive"><AlertDescription>{t('conversationSettings.validation.bounds')}</AlertDescription></Alert>}
              <div className="flex justify-end">
                <Button type="button" onClick={() => void save()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {saving ? t('conversationSettings.actions.saving') : t('conversationSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumberSetting({ id, label, description, value, min, max, disabled, onChange }: { id: string; label: string; description: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={Number.isNaN(value) ? '' : value} min={min} max={max} disabled={disabled} aria-describedby={`${id}-help`} onChange={(event) => onChange(event.target.value)} />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
