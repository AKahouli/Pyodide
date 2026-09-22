import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getLoginSettings, setLoginSettings } from '../api';
import { usePermissions } from '../hooks/usePermissions';

const EXPIRY_PATTERN = /^\d+[smhd]$/;

export function LoginSettingsCard() {
  const { t } = useModuleTranslation('admin');
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('system.maintenance') || hasPermission('system.*') || hasPermission('*');
  const [accessExpiry, setAccessExpiry] = useState('3600m');
  const [refreshExpiry, setRefreshExpiry] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void getLoginSettings()
      .then((settings) => {
        if (!active) return;
        setAccessExpiry(settings.accessExpiry);
        setRefreshExpiry(settings.refreshExpiry);
      })
      .catch(() => showError(t('system.login.toasts.loadFailed')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [t]);

  const save = async () => {
    if (!EXPIRY_PATTERN.test(accessExpiry) || !EXPIRY_PATTERN.test(refreshExpiry)) {
      setError(true);
      return;
    }
    setError(false);
    setSaving(true);
    try {
      const settings = await setLoginSettings({ accessExpiry, refreshExpiry });
      setAccessExpiry(settings.accessExpiry);
      setRefreshExpiry(settings.refreshExpiry);
      showSuccess(t('system.login.toasts.saved'));
    } catch {
      showError(t('system.login.toasts.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>{t('system.login.card.title')}</CardTitle>
            <CardDescription>{t('system.login.card.description')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="access-expiry">{t('system.login.access.label')}</Label>
            <Input id="access-expiry" value={accessExpiry} onChange={(event) => setAccessExpiry(event.target.value)} disabled={loading || saving || !canManage} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refresh-expiry">{t('system.login.refresh.label')}</Label>
            <Input id="refresh-expiry" value={refreshExpiry} onChange={(event) => setRefreshExpiry(event.target.value)} disabled={loading || saving || !canManage} className="font-mono" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('system.login.helper')}</p>
        {error && <p className="text-xs text-destructive">{t('system.login.validation.format')}</p>}
        {!canManage && <p className="text-xs text-muted-foreground">{t('system.login.readOnly')}</p>}
        {canManage && (
          <Button type="button" onClick={() => void save()} disabled={loading || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t(saving ? 'system.login.actions.saving' : 'system.login.actions.save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
