import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';

interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  name: string;
}

export function DeleteProjectDialog({ open, onOpenChange, onConfirm, name }: DeleteProjectDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const { t } = useModuleTranslation('sidebar');
  const { t: tCommon } = useModuleTranslation('common');

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('projects.delete.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('projects.delete.description.before')}
            <span className='font-medium'>"{name}"</span>
            {t('projects.delete.description.after')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{tCommon('actionCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={deleting}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
          >
            {deleting ? t('projects.delete.deleting') : tCommon('actionDelete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
