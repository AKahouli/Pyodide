import { Settings } from 'lucide-react';

import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { useModuleTranslation } from '@/modules/localization';

type SettingsHeaderProps = Readonly<{
  workspaceName?: string;
}>;

export function SettingsHeader({ workspaceName }: SettingsHeaderProps) {
  const { t } = useModuleTranslation('workspace');

  return (
    <DialogHeader className='px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b shrink-0'>
      <DialogTitle className='flex items-center gap-2 text-base sm:text-lg'>
        <Settings className='h-4 w-4 sm:h-5 sm:w-5' />
        {t('settings.modal.title')}
      </DialogTitle>
      <DialogDescription className='text-xs sm:text-sm'>{workspaceName ? <span className='truncate block'>{t('settings.modal.descriptionWithName', { name: workspaceName })}</span> : t('settings.modal.description')}</DialogDescription>
    </DialogHeader>
  );
}
