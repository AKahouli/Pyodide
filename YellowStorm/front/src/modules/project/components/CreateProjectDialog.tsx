import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
  initialName?: string;
}

export function CreateProjectDialog({ open, onOpenChange, onCreate, initialName = '' }: CreateProjectDialogProps) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useModuleTranslation('sidebar');
  const { t: tCommon } = useModuleTranslation('common');

  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onCreate(trimmed);
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
          <DialogTitle>{t('projects.create.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('projects.create.placeholder')}
            maxLength={100}
            autoFocus
          />
          <DialogFooter className='mt-4'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {tCommon('actionCancel')}
            </Button>
            <Button type='submit' disabled={submitting || !name.trim()}>
              {submitting ? t('projects.create.creating') : t('projects.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
