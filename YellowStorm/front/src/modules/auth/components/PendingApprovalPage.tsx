import { AlertTriangle } from 'lucide-react';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

interface PendingApprovalPageProps {
  onLogout: () => void;
}

export function PendingApprovalPage({ onLogout }: PendingApprovalPageProps) {
  const { t } = useModuleTranslation('auth');

  return (
    <div
      role='alertdialog'
      aria-labelledby='pending-approval-message'
      aria-modal='true'
      className='fixed inset-0 z-[100] flex flex-col bg-background'
    >
      <header className='absolute left-6 top-6 z-10'>
        <AppBrandLogo className='h-12 w-56' />
      </header>
      <main className='flex flex-1 flex-col items-center justify-center px-6'>
        <div className='flex w-full max-w-lg flex-col items-center gap-8'>
          <Alert className='border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-50 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400'>
            <AlertTriangle aria-hidden className='h-4 w-4' />
            <AlertDescription id='pending-approval-message' className='text-sm font-medium leading-relaxed sm:text-base'>
              {t('pendingApproval.message')}
            </AlertDescription>
          </Alert>
          <Button type='button' variant='outline' onClick={onLogout}>
            {t('pendingApproval.logout')}
          </Button>
        </div>
      </main>
    </div>
  );
}
