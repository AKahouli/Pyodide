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
import { useConversationV2Translation } from '../translation';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  title?: string;
}

export function DeleteConversationDialog({ open, onOpenChange, onConfirm, title }: Props) {
  const [deleting, setDeleting] = useState(false);
  const { t } = useConversationV2Translation();
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
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{tCommon('actionCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={deleting}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
          >
            {deleting ? t('dialogs.delete.deleting') : tCommon('actionDelete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
