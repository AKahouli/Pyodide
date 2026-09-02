import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

interface InactiveAccountBannerProps {
  onLogout: () => void;
}

export function InactiveAccountBanner({ onLogout }: InactiveAccountBannerProps) {
  const { t } = useModuleTranslation('auth');

  return (
    <div
      role='alert'
      className='z-50 flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-3 text-amber-950 dark:text-amber-50'
    >
      <div className='flex min-w-0 items-start gap-2'>
        <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' aria-hidden />
        <p className='text-sm font-medium'>{t('pendingApproval.banner')}</p>
      </div>
      <Button type='button' variant='outline' size='sm' className='shrink-0' onClick={onLogout}>
        {t('pendingApproval.logout')}
      </Button>
    </div>
  );
}
