import { useEffect, useState } from 'react';
import { Loader2, Save, FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminWorkspaceEvidenceSearchConnectors, getAdminWorkspaceEvidenceSearchSettings, getAdminWorkspaceUploadSettings, updateAdminWorkspaceEvidenceSearchSettings, updateAdminWorkspaceUploadSettings } from '../api';
import type { WorkspaceEvidenceSearchConnectorOption, WorkspaceUploadSettingsResponse } from '../types';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';

const EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9+-]{0,15}$/i;

function normalizeExtension(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  return EXTENSION_PATTERN.test(withDot) ? withDot : null;
}

export function WorkspaceSettingsPage() {
  const { t } = useModuleTranslation('admin');
  const { refresh: refreshUploadExtensions } = useAllowedUploadExtensions();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extensions, setExtensions] = useState<string[]>([]);
  const [supportedExtensions, setSupportedExtensions] = useState<string[]>([]);
  const [draftInput, setDraftInput] = useState('');
  const [invalidEntry, setInvalidEntry] = useState<string | null>(null);
  const [unsupportedEntry, setUnsupportedEntry] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<WorkspaceEvidenceSearchConnectorOption[]>([]);
  const [evidenceConnectorId, setEvidenceConnectorId] = useState<string>('none');

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const [response, evidence, connectorList] = await Promise.all([getAdminWorkspaceUploadSettings(), getAdminWorkspaceEvidenceSearchSettings(), getAdminWorkspaceEvidenceSearchConnectors()]);
        if (cancelled) return;
        setExtensions(response.allowedExtensions);
        setSupportedExtensions(response.supportedExtensions);
        setEvidenceConnectorId(evidence.connectorId ?? 'none');
        setConnectors(connectorList);
      } catch (error) {
        if (!cancelled) {
          showError(t('workspaceSettings.toasts.loadError.title'), {
            description: error instanceof Error ? error.message : t('workspaceSettings.toasts.loadError.description'),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const addExtension = (raw: string): void => {
    const value = normalizeExtension(raw);
    if (!value) {
      setUnsupportedEntry(null);
      setInvalidEntry(raw);
      return;
    }
    if (!supportedExtensions.includes(value)) {
      setInvalidEntry(null);
      setUnsupportedEntry(value);
      return;
    }
    if (extensions.includes(value)) {
      setInvalidEntry(null);
      setUnsupportedEntry(null);
      setDraftInput('');
      return;
    }
    setInvalidEntry(null);
    setUnsupportedEntry(null);
    setExtensions((current) => [...current, value]);
    setDraftInput('');
  };

  const handleEvidenceConnectorSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await updateAdminWorkspaceEvidenceSearchSettings({ connectorId: evidenceConnectorId === 'none' ? null : evidenceConnectorId });
      setEvidenceConnectorId(result.connectorId ?? 'none');
      showSuccess(t('workspaceSettings.evidenceSearch.toasts.saved.title'), { description: t('workspaceSettings.evidenceSearch.toasts.saved.description') });
    } catch (error) {
      showError(t('workspaceSettings.evidenceSearch.toasts.saveError.title'), { description: error instanceof Error ? error.message : t('workspaceSettings.evidenceSearch.toasts.saveError.description') });
    } finally { setSaving(false); }
  };

  const removeExtension = (value: string): void => {
    setExtensions((current) => current.filter((entry) => entry !== value));
  };

  const handleAddSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draftInput.trim().length === 0) return;
    addExtension(draftInput);
  };

  const handleSave = async (): Promise<void> => {
    if (extensions.length === 0) {
      showError(t('workspaceSettings.validation.empty'), {
        description: t('workspaceSettings.validation.emptyDescription'),
      });
      return;
    }
    setSaving(true);
    try {
      const result = await updateAdminWorkspaceUploadSettings({ allowedExtensions: extensions });
      setExtensions(result.allowedExtensions);
      setSupportedExtensions(result.supportedExtensions);
      await refreshUploadExtensions();
      showSuccess(t('workspaceSettings.toasts.saved.title'), {
        description: t('workspaceSettings.toasts.saved.description'),
      });
    } catch (error) {
      showError(t('workspaceSettings.toasts.saveError.title'), {
        description: error instanceof Error ? error.message : t('workspaceSettings.toasts.saveError.description'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('workspaceSettings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('workspaceSettings.description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            {t('workspaceSettings.uploads.title')}
          </CardTitle>
          <CardDescription>{t('workspaceSettings.uploads.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('workspaceSettings.loading')}</span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="extension-input">{t('workspaceSettings.field.label')}</Label>
                <form className="flex gap-2" onSubmit={handleAddSubmit}>
                  <Input
                    id="extension-input"
                    value={draftInput}
                    onChange={(event) => {
                      setDraftInput(event.target.value);
                      setInvalidEntry(null);
                      setUnsupportedEntry(null);
                    }}
                    placeholder={t('workspaceSettings.field.placeholder')}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button type="submit" variant="secondary" disabled={draftInput.trim().length === 0}>
                    {t('workspaceSettings.actions.add')}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">{t('workspaceSettings.field.helper')}</p>
                {invalidEntry && (
                  <Alert variant="destructive">
                    <AlertTitle>{t('workspaceSettings.validation.invalid')}</AlertTitle>
                    <AlertDescription>
                      {t('workspaceSettings.validation.invalidDescription', { value: invalidEntry })}
                    </AlertDescription>
                  </Alert>
                )}
                {unsupportedEntry && (
                  <Alert variant="destructive">
                    <AlertTitle>{t('workspaceSettings.validation.unsupported')}</AlertTitle>
                    <AlertDescription>
                      {t('workspaceSettings.validation.unsupportedDescription', { value: unsupportedEntry })}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('workspaceSettings.list.label', { count: extensions.length })}</Label>
                {extensions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('workspaceSettings.list.empty')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {extensions.map((entry) => (
                      <Badge key={entry} variant="secondary" className="gap-1 pr-1">
                        {entry}
                        <button
                          type="button"
                          onClick={() => removeExtension(entry)}
                          className="ml-1 rounded p-0.5 hover:bg-muted-foreground/20"
                          aria-label={t('workspaceSettings.actions.remove', { value: entry })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('workspaceSettings.supported.label', { count: supportedExtensions.length })}</Label>
                <p className="text-xs text-muted-foreground">{t('workspaceSettings.supported.description')}</p>
                <div className="flex flex-wrap gap-2">
                  {supportedExtensions.map((entry) => (
                    <Badge key={entry} variant="outline">
                      {entry}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => void handleSave()} disabled={saving || extensions.length === 0}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {saving ? t('workspaceSettings.actions.saving') : t('workspaceSettings.actions.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('workspaceSettings.evidenceSearch.title')}</CardTitle><CardDescription>{t('workspaceSettings.evidenceSearch.description')}</CardDescription></CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2'><Label htmlFor='evidence-search-connector'>{t('workspaceSettings.evidenceSearch.label')}</Label>
            <Select value={evidenceConnectorId} onValueChange={setEvidenceConnectorId} disabled={loading || saving}><SelectTrigger id='evidence-search-connector'><SelectValue /></SelectTrigger><SelectContent><SelectItem value='none'>{t('workspaceSettings.evidenceSearch.none')}</SelectItem>{connectors.map((connector) => <SelectItem key={connector.id} value={connector.id}>{connector.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className='flex justify-end'><Button type='button' onClick={() => void handleEvidenceConnectorSave()} disabled={saving}>{saving ? t('workspaceSettings.actions.saving') : t('workspaceSettings.actions.save')}</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
