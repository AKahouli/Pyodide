import { appConfig } from '@/config/app';
import { useModuleTranslation } from '@/modules/localization';

export function Footer() {
  const { t } = useModuleTranslation('common');
  return (
    <footer className='flex flex-col items-center justify-between gap-4 min-h-[3rem] md:h-20 py-2 md:flex-row'>
      <p className='text-center text-sm leading-loose text-muted-foreground md:text-left'>
        {t('footer.builtBy')}{' '}
        <a href={appConfig.author.url} target='_blank' rel='noreferrer' className='font-medium underline underline-offset-4 text-primary'>
          {appConfig.author.name}.
        </a>
      </p>
    </footer>
  );
}
