import { useEffect, useState } from 'react';
import { Download, Loader2, Save, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import {
  exportSystemSettings,
  getAdminPlatformSettings,
  importSystemSettings,
  updateAdminPlatformSettings,
  type AdminPlatformSettings,
} from '../api';

const DEFAULT_SETTINGS: AdminPlatformSettings = {
  throttle: { limit: 100, windowSeconds: 60 },
  auth: { maxSessionsPerUser: 10 },
  documentUpload: { maxFileSizeMb: 50, maxFilesPerUpload: 10, allowedMimeTypes: [] },
};

function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function PlatformSettingsPage() {
  const { t } = useModuleTranslation('admin');
  const [settings, setSettings] = useState<AdminPlatformSettings>(DEFAULT_SETTINGS);
  const [mimeTypes, setMimeTypes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAdminPlatformSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings({ ...DEFAULT_SETTINGS, ...loaded });
        setMimeTypes(loaded.documentUpload.allowedMimeTypes.join(',\n'));
      })
      .catch((error) => showError(parseApiError(error).message || t('platformSettings.toasts.error')))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buildPayload = () => ({
    throttle: settings.throttle,
    auth: settings.auth,
    documentUpload: {
      ...settings.documentUpload,
      allowedMimeTypes: mimeTypes
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    },
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateAdminPlatformSettings(buildPayload());
      setSettings({ ...DEFAULT_SETTINGS, ...updated });
      setMimeTypes(updated.documentUpload.allowedMimeTypes.join(',\n'));
      showSuccess(t('platformSettings.toasts.saved'));
    } catch (error) {
      showError(parseApiError(error).message || t('platformSettings.toasts.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const payload = await exportSystemSettings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yellowstorm-settings-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError(parseApiError(error).message || t('platformSettings.toasts.error'));
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const payload = JSON.parse(await file.text()) as Parameters<typeof importSystemSettings>[0];
      const result = await importSystemSettings(payload);
      showSuccess(
        t('platformSettings.toasts.imported')
          .replace('{imported}', String(result.imported.length))
          .replace('{skipped}', String(result.skipped.length)),
      );
      const refreshed = await getAdminPlatformSettings();
      setSettings({ ...DEFAULT_SETTINGS, ...refreshed });
      setMimeTypes(refreshed.documentUpload.allowedMimeTypes.join(',\n'));
    } catch (error) {
      showError(parseApiError(error).message || t('platformSettings.toasts.error'));
    } finally {
      setImporting(false);
    }
  };

  const numberField = (
    id: string,
    label: string,
    value: number,
    onChange: (next: number) => void,
    min?: number,
    max?: number,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(toNumber(event.target.value, value))}
      />
    </div>
  );

  return (
    <div className="space-y-6" data-testid="platform-settings-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('platformSettings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('platformSettings.description')}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('platformSettings.throttle.title')}</CardTitle>
              <CardDescription>{t('platformSettings.throttle.description')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {numberField(
                'throttle-limit',
                t('platformSettings.throttle.limit'),
                settings.throttle.limit,
                (limit) => setSettings((prev) => ({ ...prev, throttle: { ...prev.throttle, limit } })),
                1,
              )}
              {numberField(
                'throttle-window',
                t('platformSettings.throttle.windowSeconds'),
                settings.throttle.windowSeconds,
                (windowSeconds) => setSettings((prev) => ({ ...prev, throttle: { ...prev.throttle, windowSeconds } })),
                1,
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('platformSettings.auth.title')}</CardTitle>
              <CardDescription>{t('platformSettings.auth.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {numberField(
                'auth-max-sessions',
                t('platformSettings.auth.maxSessionsPerUser'),
                settings.auth.maxSessionsPerUser,
                (maxSessionsPerUser) => setSettings((prev) => ({ ...prev, auth: { ...prev.auth, maxSessionsPerUser } })),
                1,
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('platformSettings.documentUpload.title')}</CardTitle>
              <CardDescription>{t('platformSettings.documentUpload.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {numberField(
                  'upload-max-size',
                  t('platformSettings.documentUpload.maxFileSizeMb'),
                  settings.documentUpload.maxFileSizeMb,
                  (maxFileSizeMb) =>
                    setSettings((prev) => ({ ...prev, documentUpload: { ...prev.documentUpload, maxFileSizeMb } })),
                  1,
                )}
                {numberField(
                  'upload-max-files',
                  t('platformSettings.documentUpload.maxFilesPerUpload'),
                  settings.documentUpload.maxFilesPerUpload,
                  (maxFilesPerUpload) =>
                    setSettings((prev) => ({ ...prev, documentUpload: { ...prev.documentUpload, maxFilesPerUpload } })),
                  1,
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="upload-mime-types">{t('platformSettings.documentUpload.allowedMimeTypes')}</Label>
                <Textarea
                  id="upload-mime-types"
                  rows={6}
                  value={mimeTypes}
                  placeholder={t('platformSettings.documentUpload.allowedMimeTypesPlaceholder')}
                  onChange={(event) => setMimeTypes(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('platformSettings.documentUpload.allowedMimeTypesHelp')}</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t('platformSettings.actions.save')}
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              {t('platformSettings.actions.export')}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {t('platformSettings.actions.import')}
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void handleImport(file);
                }}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
