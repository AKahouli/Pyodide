import { Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceSetting } from '../../../types';

type CurrentSettingsCardProps = Readonly<{
  currentSettings: WorkspaceSetting | null;
  onClear: () => void;
}>;

export function CurrentSettingsCard({ currentSettings, onClear }: CurrentSettingsCardProps) {
  const { t } = useModuleTranslation('workspace');
  const { t: tCommon } = useModuleTranslation('common');

  return (
    <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 rounded-lg border p-3 bg-muted/30'>
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium'>{t('settings.current.title')}</p>
        <p className='text-xs text-muted-foreground truncate'>
          {currentSettings ? (
            <span className='flex items-center gap-1.5 flex-wrap'>
              <span className='truncate'>{t('settings.current.using', { name: currentSettings.name })}</span>
              {currentSettings.isTemplate && (
                <Badge variant='secondary' className='text-[10px] h-4 px-1.5 shrink-0'>
                  {t('settings.current.templateBadge')}
                </Badge>
              )}
            </span>
          ) : (
            t('settings.current.default')
          )}
        </p>
      </div>
      {currentSettings && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant='ghost' size='sm' className='text-destructive hover:text-destructive h-8 px-2 sm:px-3 self-end sm:self-auto'>
              <Trash2 className='h-4 w-4 sm:mr-1' />
              <span className='hidden sm:inline'>{t('settings.current.clear')}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className='w-[90vw] max-w-md'>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('settings.current.clearDialogTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('settings.current.clearDialogDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className='flex-col sm:flex-row gap-2 sm:gap-0'>
              <AlertDialogCancel className='mt-0'>{tCommon('actionCancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={onClear}>{t('settings.current.clearAction')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
