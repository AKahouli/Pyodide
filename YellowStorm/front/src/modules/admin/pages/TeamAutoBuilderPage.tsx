import { useEffect, useState } from 'react';
import { Loader2, Save, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useModuleTranslation } from '@/modules/localization';
import { usePermissions } from '../hooks/usePermissions';
import { getAllModels, getTeamAutoBuilderConfig, upsertTeamAutoBuilderConfig } from '../api';
import type { AdminModelResponse, UpsertTeamAutoBuilderConfigRequest } from '../types';
import { getErrorMessage } from '@/lib/error-codes';
import type { ApiError } from '@/lib/api/client';

export function TeamAutoBuilderPage() {
  const { t } = useModuleTranslation('admin');
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('team_auto_builder.update');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<AdminModelResponse[]>([]);

  const [modelId, setModelId] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [modelsData, config] = await Promise.all([
          getAllModels(),
          getTeamAutoBuilderConfig(),
        ]);
        const activeModels = modelsData.models.filter((m) => m.isActive);
        setModels(activeModels);
        if (config) {
          setModelId(config.modelId);
          setSystemPrompt(config.systemPrompt);
          setTemperature(config.temperature);
          setIsEnabled(config.isEnabled);
        } else if (activeModels.length > 0) {
          setModelId(activeModels[0].id);
        }
      } catch {
        toast.error(t('teamAutoBuilder.errors.loadFailed'));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [t]);

  const handleSave = async () => {
    if (!modelId || !systemPrompt) return;
    setSaving(true);
    try {
      const data: UpsertTeamAutoBuilderConfigRequest = { modelId, systemPrompt, temperature, isEnabled };
      await upsertTeamAutoBuilderConfig(data);
      toast.success(t('teamAutoBuilder.toasts.saved'));
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(t('teamAutoBuilder.errors.saveFailed'), {
        description: apiErr?.code ? getErrorMessage(apiErr.code) : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center py-20'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    );
  }

  return (
    <div className='space-y-6 max-w-2xl'>
      <div>
        <h1 className='text-2xl font-bold flex items-center gap-2'>
          <Wand2 className='h-6 w-6' />
          {t('teamAutoBuilder.title')}
        </h1>
        <p className='text-muted-foreground mt-1'>{t('teamAutoBuilder.description')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle>{t('teamAutoBuilder.settings.title')}</CardTitle>
              <CardDescription>{t('teamAutoBuilder.settings.description')}</CardDescription>
            </div>
            <div className='flex items-center gap-2'>
              <Label htmlFor='auto-builder-enabled'>{t('teamAutoBuilder.fields.enabled')}</Label>
              <Switch
                id='auto-builder-enabled'
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
                disabled={!canUpdate}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('teamAutoBuilder.fields.model')}</Label>
            <Select value={modelId} onValueChange={setModelId} disabled={!canUpdate}>
              <SelectTrigger>
                <SelectValue placeholder={t('teamAutoBuilder.fields.modelPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <Label>{t('teamAutoBuilder.fields.systemPrompt')}</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t('teamAutoBuilder.fields.systemPromptPlaceholder')}
              rows={8}
              disabled={!canUpdate}
              className='font-mono text-sm'
            />
            <p className='text-xs text-muted-foreground'>{t('teamAutoBuilder.fields.systemPromptHelp')}</p>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label>{t('teamAutoBuilder.fields.temperature')}</Label>
              <Input
                type='number'
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
                min={0}
                max={2}
                step={0.1}
                disabled={!canUpdate}
              />
            </div>
          </div>

          {canUpdate && (
            <div className='flex justify-end pt-2'>
              <Button onClick={handleSave} disabled={saving || !modelId || !systemPrompt}>
                {saving ? <Loader2 className='mr-1 h-4 w-4 animate-spin' /> : <Save className='mr-1 h-4 w-4' />}
                {saving ? t('teamAutoBuilder.actions.saving') : t('teamAutoBuilder.actions.save')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
