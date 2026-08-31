import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useAppBuilderStore } from '../store';
import type { DeployedAppSource } from '../types';

export function DeleteDeployedAppButton({
  sessionId,
  source = 'owned',
}: {
  sessionId: string;
  source?: DeployedAppSource;
}) {
  const { t } = useModuleTranslation('app-builder');
  const [open, setOpen] = useState(false);
  const removeApp = useAppBuilderStore((state) => state.removeApp);
  const isDeleting = useAppBuilderStore(
    (state) => state.deletingSessionId === sessionId,
  );
  const isShared = source === 'shared';

  const handleDelete = async () => {
    try {
      await removeApp(sessionId);
      showSuccess(isShared ? t('card.unshareSuccess') : t('card.deleteSuccess'));
      setOpen(false);
    } catch {
      showError(isShared ? t('card.unshareError') : t('card.deleteError'));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={isShared ? t('card.unshare') : t('card.delete')}
        >
          <Trash2 className='h-4 w-4 text-destructive' />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isShared ? t('card.unshareTitle') : t('card.deleteTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isShared ? t('card.unshareDescription') : t('card.deleteDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('card.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={isDeleting} onClick={handleDelete}>
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {isShared ? t('card.unshare') : t('card.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
