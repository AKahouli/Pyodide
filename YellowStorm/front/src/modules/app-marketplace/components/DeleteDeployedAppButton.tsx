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
import { useAppMarketplaceStore } from '../store';

export function DeleteDeployedAppButton({ sessionId }: { sessionId: string }) {
  const { t } = useModuleTranslation('app-marketplace');
  const [open, setOpen] = useState(false);
  const removeApp = useAppMarketplaceStore((state) => state.removeApp);
  const isDeleting = useAppMarketplaceStore(
    (state) => state.deletingSessionId === sessionId,
  );

  const handleDelete = async () => {
    try {
      await removeApp(sessionId);
      showSuccess(t('card.deleteSuccess'));
      setOpen(false);
    } catch {
      showError(t('card.deleteError'));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant='ghost' size='icon-sm' aria-label={t('card.delete')}>
          <Trash2 className='h-4 w-4 text-destructive' />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('card.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('card.deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('card.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={isDeleting} onClick={handleDelete}>
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('card.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
