import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

type UpgradeHeaderProps = Readonly<{
  onBack: () => void;
}>;

export function UpgradeHeader({ onBack }: UpgradeHeaderProps) {
  const { t } = useModuleTranslation('usage');

  return (
    <div className='flex items-center gap-4'>
      {/* Back Button - fixed width on mobile for consistency */}
      <Button variant='ghost' size='sm' onClick={onBack} className='shrink-0' aria-label={t('usage.upgrade.back')}>
        <ArrowLeft className='h-4 w-4 sm:mr-2' />
        <span className='hidden sm:inline'>{t('usage.upgrade.back')}</span>
      </Button>

      {/* Title Section - grows to fill space */}
      <div className='flex-1 min-w-0 text-center sm:text-left'>
        <h1 className='text-xl sm:text-2xl lg:text-3xl font-bold truncate'>{t('usage.upgrade.heading')}</h1>
        <p className='text-xs sm:text-sm text-muted-foreground truncate hidden sm:block'>{t('usage.upgrade.subheading')}</p>
      </div>
    </div>
  );
}
