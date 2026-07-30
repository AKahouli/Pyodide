import { useEffect, useState } from 'react';
import { Download, Loader2, ShieldAlert, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { exportConnectorCatalog, exportSkillCatalog, importCatalog } from '../api';
import type { CatalogConflictPolicy, CatalogImportResult } from '../types';

interface CatalogTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'export' | 'import';
  resource: 'connectors' | 'skills';
  selectedIds: string[];
  onImported: () => void;
}

export function CatalogTransferDialog({
  open,
  onOpenChange,
  mode,
  resource,
  selectedIds,
  onImported,
}: CatalogTransferDialogProps) {
  const { t } = useModuleTranslation('admin');
  const [scope, setScope] = useState<'selected' | 'all'>(selectedIds.length ? 'selected' : 'all');
  const [includeSecurity, setIncludeSecurity] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<CatalogConflictPolicy>('skip');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<CatalogImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.length ? 'selected' : 'all');
    setIncludeSecurity(false);
    setPassphrase('');
    setFile(null);
    setConflictPolicy('skip');
    setResult(null);
  }, [open, selectedIds.length]);

  const handleExport = async () => {
    if (scope === 'selected' && !selectedIds.length) return;
    if (includeSecurity && passphrase.length < 12) {
      showError(t('catalogTransfer.passphraseMinimum'));
      return;
    }
    setWorking(true);
    try {
      const request = {
        selection: scope,
        ids: scope === 'selected' ? selectedIds : undefined,
        includeSecurity: resource === 'connectors' ? includeSecurity : false,
        passphrase: includeSecurity ? passphrase : undefined,
      } as const;
      const blob = resource === 'connectors'
        ? await exportConnectorCatalog(request)
        : await exportSkillCatalog(request);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `yellowstorm-${resource}-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      showSuccess(t('catalogTransfer.exportSuccess'));
      onOpenChange(false);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('catalogTransfer.exportError'));
    } finally {
      setWorking(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setWorking(true);
    try {
      const imported = await importCatalog(file, conflictPolicy, passphrase || undefined);
      setResult(imported);
      onImported();
      showSuccess(t('catalogTransfer.importSuccess'));
    } catch (error) {
      showError(error instanceof Error ? error.message : t('catalogTransfer.importError'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'export' ? t('catalogTransfer.exportTitle') : t('catalogTransfer.importTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'export' ? t('catalogTransfer.exportDescription') : t('catalogTransfer.importDescription')}
          </DialogDescription>
        </DialogHeader>

        {mode === 'export' ? (
          <div className='space-y-5 py-2'>
            <RadioGroup value={scope} onValueChange={(value) => setScope(value as 'selected' | 'all')}>
              <div className='flex items-center gap-3 rounded-md border p-3'>
                <RadioGroupItem value='selected' id='catalog-selected' disabled={!selectedIds.length} />
                <Label htmlFor='catalog-selected' className='flex-1 cursor-pointer'>
                  {t('catalogTransfer.selectedItems', { count: selectedIds.length })}
                </Label>
              </div>
              <div className='flex items-center gap-3 rounded-md border p-3'>
                <RadioGroupItem value='all' id='catalog-all' />
                <Label htmlFor='catalog-all' className='flex-1 cursor-pointer'>
                  {resource === 'connectors' ? t('catalogTransfer.allConnectors') : t('catalogTransfer.allSkills')}
                </Label>
              </div>
            </RadioGroup>

            {resource === 'connectors' ? (
              <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3'>
                <div className='flex items-start gap-3'>
                  <ShieldAlert className='mt-0.5 h-5 w-5 text-amber-600' />
                  <div className='space-y-1'>
                    <Label htmlFor='include-security'>{t('catalogTransfer.includeSecurity')}</Label>
                    <p className='text-xs text-muted-foreground'>{t('catalogTransfer.securityDescription')}</p>
                  </div>
                  <Checkbox
                    id='include-security'
                    checked={includeSecurity}
                    onCheckedChange={(checked) => setIncludeSecurity(checked === true)}
                  />
                </div>
                {includeSecurity ? (
                  <div className='space-y-2'>
                    <Label htmlFor='export-passphrase'>{t('catalogTransfer.passphrase')}</Label>
                    <Input
                      id='export-passphrase'
                      type='password'
                      autoComplete='new-password'
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className='space-y-4 py-2'>
            <div className='space-y-2'>
              <Label htmlFor='catalog-file'>{t('catalogTransfer.archiveFile')}</Label>
              <Input
                id='catalog-file'
                type='file'
                accept='.json,application/json'
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='import-passphrase'>{t('catalogTransfer.passphraseOptional')}</Label>
              <Input
                id='import-passphrase'
                type='password'
                autoComplete='current-password'
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </div>
            <div className='flex items-start gap-3 rounded-md border p-3'>
              <Checkbox
                id='overwrite-existing'
                checked={conflictPolicy === 'overwrite'}
                onCheckedChange={(checked) => setConflictPolicy(checked === true ? 'overwrite' : 'skip')}
              />
              <div>
                <Label htmlFor='overwrite-existing'>{t('catalogTransfer.overwriteExisting')}</Label>
                <p className='text-xs text-muted-foreground'>{t('catalogTransfer.overwriteDescription')}</p>
              </div>
            </div>
            {result ? (
              <div className='rounded-md bg-muted p-3 text-sm' role='status'>
                {t('catalogTransfer.importSummary', {
                  skills: result.skills.created + result.skills.updated,
                  connectors: result.connectors.created + result.connectors.updated,
                  skipped: result.skills.skipped + result.connectors.skipped,
                })}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={working}>
            {t('catalogTransfer.close')}
          </Button>
          <Button
            onClick={mode === 'export' ? handleExport : handleImport}
            disabled={working || (mode === 'import' ? !file : scope === 'selected' && !selectedIds.length)}
          >
            {working ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : mode === 'export' ? <Download className='mr-2 h-4 w-4' /> : <Upload className='mr-2 h-4 w-4' />}
            {mode === 'export' ? t('catalogTransfer.exportAction') : t('catalogTransfer.importAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
