import { useEffect, useState } from 'react';
import { EyeOff, Loader2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { setCachedConversationSettings } from '@/modules/conversation';
import { getAdminConversationSettings, updateSensitiveTextRedaction } from '../api';

export function SensitiveTextRedactionCard() {
  const { t } = useModuleTranslation('admin');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAdminConversationSettings()
      .then((settings) => {
        if (!cancelled) setEnabled(settings.redactSensitiveText !== false);
      })
      .catch((error) => {
        if (!cancelled) showError(t('system.redaction.loadError'), { description: error instanceof Error ? error.message : undefined });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const update = async (redactSensitiveText: boolean) => {
    setSaving(true);
    try {
      const settings = await updateSensitiveTextRedaction({ redactSensitiveText });
      setEnabled(settings.redactSensitiveText !== false);
      setCachedConversationSettings(settings);
      showSuccess(t('system.redaction.saved'));
    } catch (error) {
      showError(t('system.redaction.saveError'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
            <EyeOff className='h-5 w-5' />
          </div>
          <div>
            <CardTitle>{t('system.redaction.title')}</CardTitle>
            <CardDescription>{t('system.redaction.description')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center justify-between gap-6 rounded-lg border p-4'>
          <div className='space-y-1'>
            <Label htmlFor='sensitive-text-redaction'>{t('system.redaction.toggle')}</Label>
            <p className='text-xs text-muted-foreground'>{t('system.redaction.toggleDescription')}</p>
          </div>
          {loading || saving ? (
            <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
          ) : (
            <Switch id='sensitive-text-redaction' checked={enabled} onCheckedChange={(checked) => void update(checked)} />
          )}
        </div>
        {!enabled && (
          <Alert variant='destructive'>
            <ShieldAlert className='h-4 w-4' />
            <AlertTitle>{t('system.redaction.warningTitle')}</AlertTitle>
            <AlertDescription>{t('system.redaction.warningDescription')}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
