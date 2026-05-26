import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationV2Translation } from '../translation';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTitle: string;
  onRename: (newTitle: string) => Promise<void>;
}

export function RenameDialog({ open, onOpenChange, currentTitle, onRename }: Props) {
  const [title, setTitle] = useState(currentTitle);
  const [saving, setSaving] = useState(false);
  const { t } = useConversationV2Translation();
  const { t: tCommon } = useModuleTranslation('common');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || trimmed === currentTitle) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogs.rename.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('dialogs.rename.placeholder')}
            maxLength={200}
            autoFocus
          />
          <DialogFooter className='mt-4'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {tCommon('actionCancel')}
            </Button>
            <Button type='submit' disabled={saving || !title.trim()}>
              {saving ? t('dialogs.rename.saving') : tCommon('actionSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
