import { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';

interface DeleteConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  title?: string;
  /** Adds a warning that deleting also revokes shared people and public links. */
  isShared?: boolean;
}

export function DeleteConversationDialog({ open, onOpenChange, onConfirm, title, isShared }: DeleteConversationDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('dialogs.delete.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {title ? (
              <>
                {t('dialogs.delete.descriptionWithName.before')}
                <span className='font-medium'>"{title}"</span>
                {t('dialogs.delete.descriptionWithName.after')}
              </>
            ) : (
              t('dialogs.delete.description')
            )}{' '}
            {t('dialogs.delete.warning')}
          </AlertDialogDescription>
          {isShared && (
            <p data-shared-delete-warning className='text-sm font-medium text-destructive'>
              {t('dialogs.delete.sharedWarning')}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{tCommon('actionCancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isDeleting} className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
            {isDeleting ? t('dialogs.delete.deleting') : tCommon('actionDelete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
