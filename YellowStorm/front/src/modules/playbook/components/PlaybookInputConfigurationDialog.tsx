import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookInputDescriptor } from '../types';
import { PlaybookInputSourcePicker } from './PlaybookInputSourcePicker';

interface Props {
  input: PlaybookInputDescriptor | null;
  value?: unknown;
  dirty: boolean;
  onValueChange: (value: unknown) => void;
  onDismiss: () => void;
  onSave: () => Promise<boolean>;
  onSaveError: () => void;
}

export function canDismissPlaybookInputConfiguration(isSaving: boolean, isDirty: boolean): boolean {
  return !isSaving && !isDirty;
}

export function PlaybookInputConfigurationDialog({
  input,
  value,
  dirty,
  onValueChange,
  onDismiss,
  onSave,
  onSaveError,
}: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const [saving, setSaving] = useState(false);
  const [dismissAfterSave, setDismissAfterSave] = useState(false);
  const dismiss = () => {
    if (canDismissPlaybookInputConfiguration(saving, dirty)) onDismiss();
  };

  useEffect(() => {
    if (!dismissAfterSave || saving || dirty) return;
    setDismissAfterSave(false);
    if (canDismissPlaybookInputConfiguration(saving, dirty)) onDismiss();
  }, [dirty, dismissAfterSave, onDismiss, saving]);

  const save = async () => {
    if (!input || value === undefined || saving) return;
    setSaving(true);
    try {
      if (await onSave()) setDismissAfterSave(true);
    } catch {
      onSaveError();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(input)} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{input?.label}</DialogTitle>
          <DialogDescription>{t('inputs.configurationDescription')}</DialogDescription>
        </DialogHeader>
        {input ? <PlaybookInputSourcePicker input={input} value={value} onChange={onValueChange} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={!canDismissPlaybookInputConfiguration(saving, dirty)} onClick={dismiss}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!input || value === undefined || saving} onClick={() => void save()}>
            {saving ? t('inputs.savingConfiguration') : t('inputs.saveConfiguration')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
