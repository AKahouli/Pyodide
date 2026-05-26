import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';

interface RenameProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (name: string) => Promise<void>;
}

export function RenameProjectDialog({ open, onOpenChange, currentName, onRename }: RenameProjectDialogProps) {
  const [name, setName] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useModuleTranslation('sidebar');
  const { t: tCommon } = useModuleTranslation('common');

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    try {
      await onRename(trimmed);
      onOpenChange(false);
    } catch {
      // error already toasted by the store
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects.rename.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          <DialogFooter className='mt-4'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {tCommon('actionCancel')}
            </Button>
            <Button type='submit' disabled={submitting || !name.trim()}>
              {tCommon('actionSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
