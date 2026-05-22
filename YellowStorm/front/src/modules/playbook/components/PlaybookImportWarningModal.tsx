import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  importedName: string;
  isDirty: boolean;
}

export function PlaybookImportWarningModal({
  open,
  onOpenChange,
  onConfirm,
  importedName,
  isDirty,
}: Props) {
  const { t } = useModuleTranslation('playbook');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('import.warningTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {t('import.warningDescription', { name: importedName })}
              </p>
              {isDirty && (
                <p className="text-amber-600 dark:text-amber-400">
                  {t('import.unsavedWarning')}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('import.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('import.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
