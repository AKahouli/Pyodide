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

export function DeleteDraftAppButton({ sessionId }: { sessionId: string }) {
  const { t } = useModuleTranslation('app-builder');
  const [open, setOpen] = useState(false);
  const removeDraft = useAppBuilderStore((state) => state.removeDraft);
  const isDeleting = useAppBuilderStore((state) => state.deletingSessionId === sessionId);

  const handleDelete = async () => {
    try {
      await removeDraft(sessionId);
      showSuccess(t('card.deleteDraftSuccess'));
      setOpen(false);
    } catch {
      showError(t('card.deleteDraftError'));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive'
          aria-label={t('card.deleteDraft')}
        >
          <Trash2 className='h-3.5 w-3.5' />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('card.deleteDraftTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('card.deleteDraftDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('card.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={isDeleting} onClick={handleDelete}>
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('card.deleteDraft')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
