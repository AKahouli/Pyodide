import { buttonVariants } from '@/components/ui/button';
import { NavLink } from 'react-router-dom';
import { useModuleTranslation } from '@/modules/localization';

export default function NoMatch() {
  const { t } = useModuleTranslation('common');

  return (
    <div className='bg-background text-foreground grow flex items-center justify-center'>
      <div className='space-y-4'>
        <h2 className='text-8xl mb-4'>404</h2>
        <h1 className='text-3xl font-semibold'>{t('pages.noMatch.title')}</h1>
        <p className='text-sm text-muted-foreground'>{t('pages.noMatch.description')}</p>
        <NavLink to='/' className={buttonVariants()}>
          {t('pages.noMatch.cta')}
        </NavLink>
      </div>
    </div>
  );
}
