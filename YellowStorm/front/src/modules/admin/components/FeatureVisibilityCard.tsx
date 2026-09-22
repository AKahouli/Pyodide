import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  ChevronDown,
  Layers3,
  Loader2,
  MessageSquare,
  Network,
  ShieldCheck,
  Sparkles,
  Store,
  Workflow,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { getFeatureVisibility, updateFeatureVisibility } from '../api';
import { DEFAULT_FEATURE_VISIBILITY, FEATURE_PERMISSION_ITEMS, FEATURE_SETTING_ITEMS } from '../constants';
import { useFeatureVisibilityStore } from '../featureVisibilityStore';
import { usePermissions } from '../hooks/usePermissions';
import type { FeatureVisibility } from '../types';

const FEATURES = [
  { key: 'conversation', icon: MessageSquare, labelKey: 'system.features.items.conversation.label', descriptionKey: 'system.features.items.conversation.description' },
  { key: 'workspace', icon: Layers3, labelKey: 'system.features.items.workspace.label', descriptionKey: 'system.features.items.workspace.description' },
  { key: 'playbook', icon: Workflow, labelKey: 'system.features.items.playbook.label', descriptionKey: 'system.features.items.playbook.description' },
  { key: 'governance', icon: ShieldCheck, labelKey: 'system.features.items.governance.label', descriptionKey: 'system.features.items.governance.description' },
  { key: 'appBuilder', icon: Store, labelKey: 'system.features.items.appBuilder.label', descriptionKey: 'system.features.items.appBuilder.description' },
  { key: 'worky', icon: Sparkles, labelKey: 'system.features.items.worky.label', descriptionKey: 'system.features.items.worky.description' },
  { key: 'agents', icon: Bot, labelKey: 'system.features.items.agents.label', descriptionKey: 'system.features.items.agents.description' },
  { key: 'semanticModel', icon: Network, labelKey: 'system.features.items.semanticModel.label', descriptionKey: 'system.features.items.semanticModel.description' },
  { key: 'platformCopilot', icon: Sparkles, labelKey: 'system.features.items.platformCopilot.label', descriptionKey: 'system.features.items.platformCopilot.description' },
] as const;
const FEATURE_ICONS = {
  conversation: MessageSquare,
  workspace: Layers3,
  playbook: Workflow,
  governance: ShieldCheck,
  appBuilder: Store,
  worky: Sparkles,
  agents: Bot,
  semanticModel: Network,
  platformCopilot: Sparkles,
} as const;

export function FeatureVisibilityCard() {
  const { t } = useModuleTranslation('admin');
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('system.maintenance');
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<FeatureVisibility>(DEFAULT_FEATURE_VISIBILITY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const setPersistedVisibility = useFeatureVisibilityStore((state) => state.setVisibility);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const value = await getFeatureVisibility();
      setVisibility(value);
      setPersistedVisibility(value);
    } catch {
      setLoadFailed(true);
      showError(t('system.features.toasts.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [setPersistedVisibility, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const value = await updateFeatureVisibility(visibility);
      setVisibility(value);
      setPersistedVisibility(value);
      showSuccess(t('system.features.toasts.saved'));
    } catch {
      showError(t('system.features.toasts.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = Object.values(visibility).filter(Boolean).length;

  return (
    <Card className="gap-0 py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 rounded-xl px-6 py-5 text-left hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold">{t('system.features.card.title')}</div>
                <div className="text-sm text-muted-foreground">{t('system.features.card.description')}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {loading
                  ? t('system.features.status.loading')
                  : t('system.features.status.summary', { enabled: enabledCount, total: FEATURE_PERMISSION_ITEMS.length + FEATURE_SETTING_ITEMS.length })}
              </span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 border-t py-5">
            {loadFailed ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 p-4">
                <p className="text-sm text-destructive">{t('system.features.errors.load')}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                  {t('system.features.actions.retry')}
                </Button>
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {FEATURE_PERMISSION_ITEMS.map((feature) => {
                  const Icon = FEATURE_ICONS[feature.key as keyof typeof FEATURE_ICONS];
                  const id = `feature-visibility-${feature.key}`;
                  const settings = FEATURE_SETTING_ITEMS.filter((item) => item.group === feature.key);
                  return (
                    <div key={feature.key}>
                      <div className="flex items-center justify-between gap-4 p-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div>
                            <Label htmlFor={id} className="font-medium">{t(feature.labelKey)}</Label>
                            <p className="text-sm text-muted-foreground">{t(feature.descriptionKey)}</p>
                          </div>
                        </div>
                        <Switch
                          id={id}
                          checked={visibility[feature.key]}
                          onCheckedChange={(checked) => setVisibility((current) => ({ ...current, [feature.key]: checked }))}
                          disabled={loading || saving || !canManage}
                        />
                      </div>
                      {settings.map((setting) => {
                        const settingId = `feature-visibility-${setting.key}`;
                        return (
                          <div key={setting.key} className="flex items-center justify-between gap-4 border-t bg-muted/20 py-3 pl-11 pr-4">
                            <div className="min-w-0">
                              <Label htmlFor={settingId} className="font-medium">{t(setting.labelKey)}</Label>
                              <p className="text-sm text-muted-foreground">{t(setting.descriptionKey)}</p>
                            </div>
                            <Switch
                              id={settingId}
                              checked={visibility[setting.key]}
                              onCheckedChange={(checked) => setVisibility((current) => ({ ...current, [setting.key]: checked }))}
                              disabled={loading || saving || !canManage}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {!canManage && !loadFailed && (
              <p className="text-sm text-muted-foreground">{t('system.features.readOnly')}</p>
            )}

            {!loadFailed && canManage && (
              <Button type="button" onClick={() => void save()} disabled={loading || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {saving ? t('system.features.actions.saving') : t('system.features.actions.save')}
              </Button>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
