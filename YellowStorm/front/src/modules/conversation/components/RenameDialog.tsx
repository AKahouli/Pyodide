import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTitle: string;
  onRename: (newTitle: string) => Promise<void>;
}

export function RenameDialog({ open, onOpenChange, currentTitle, onRename }: RenameDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || trimmed === currentTitle) {
      onOpenChange(false);
      return;
    }

    setIsLoading(true);
    try {
      await onRename(trimmed);
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogs.rename.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('dialogs.rename.placeholder')} maxLength={200} autoFocus />
          <DialogFooter className='mt-4'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {tCommon('actionCancel')}
            </Button>
            <Button type='submit' disabled={isLoading || !title.trim()}>
              {isLoading ? t('dialogs.rename.saving') : tCommon('actionSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
