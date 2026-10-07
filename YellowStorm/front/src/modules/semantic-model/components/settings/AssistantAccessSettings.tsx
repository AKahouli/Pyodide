import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { SettingsPane } from './SettingsPane';

/**
 * Admin > Semantic models: whether the person an agent acts for needs the semantic_models permissions.
 * Turned off, any person known to the platform can use the semantic model tools through an agent; the
 * model's own members and the workspaces' rules still apply.
 */
export function AssistantAccessSettings() {
  const { t } = useModuleTranslation('semantic-model');
  const [enforce, setEnforce] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    semanticModelApi.getAdminAssistantAccess()
      .then((settings) => setEnforce(settings.enforcePermissions))
      .catch((error) => showError(t('settings.loadError'), { description: parseApiError(error).message }));
  }, [t]);

  const change = async (next: boolean) => {
    setSaving(true);
    try {
      setEnforce((await semanticModelApi.updateAdminAssistantAccess({ enforcePermissions: next })).enforcePermissions);
      showSuccess(t('settings.saved'));
    } catch (error) {
      showError(t('settings.saveError'), { description: parseApiError(error).message });
    } finally {
      setSaving(false);
    }
  };

  const off = enforce === false;
  return <SettingsPane id='assistant-access' title={t('assistantAccess.title')} help={t('assistantAccess.description')} attention={off}
    icon={<ShieldCheck className='h-4 w-4 text-muted-foreground' aria-hidden />}
    summary={enforce === null ? undefined : t(off ? 'assistantAccess.summaryOff' : 'assistantAccess.summaryOn')}>
    <div className='flex items-start justify-between gap-4'>
      <label htmlFor='assistant-access-enforce' className='min-w-0 space-y-1 text-sm'>
        <span className='font-medium'>{t('assistantAccess.enforce')}</span>
        <span className='block text-xs text-muted-foreground'>{t('assistantAccess.enforceTip')}</span>
      </label>
      <Switch id='assistant-access-enforce' checked={enforce ?? true} disabled={enforce === null || saving}
        onCheckedChange={(next) => void change(next)} />
    </div>
    {off && <p role='alert' className='rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300'>
      {t('assistantAccess.warning')}
    </p>}
  </SettingsPane>;
}
