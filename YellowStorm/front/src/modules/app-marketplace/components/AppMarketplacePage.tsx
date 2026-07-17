import { useEffect } from 'react';
import { Store } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useAppMarketplaceStore } from '../store';
import { DeployedAppCard } from './DeployedAppCard';

export function AppMarketplacePage() {
  const { t } = useModuleTranslation('app-marketplace');
  const apps = useAppMarketplaceStore((s) => s.apps);
  const loading = useAppMarketplaceStore((s) => s.loading);
  const error = useAppMarketplaceStore((s) => s.error);
  const fetchApps = useAppMarketplaceStore((s) => s.fetchApps);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  return (
    <div className='flex size-full flex-col'>
      <div className='shrink-0 border-b px-6 py-5'>
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10'>
            <Store className='h-5 w-5 text-primary' />
          </div>
          <div>
            <h1 className='text-xl font-semibold'>{t('page.title')}</h1>
            <p className='text-sm text-muted-foreground'>{t('page.description')}</p>
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto p-6'>
        {loading && apps.length === 0 ? (
          <div className='flex items-center justify-center py-20'>
            <div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
          </div>
        ) : error ? (
          <div className='flex flex-col items-center justify-center py-20 text-muted-foreground'>
            <p>{t('page.error')}</p>
          </div>
        ) : apps.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-20 text-muted-foreground'>
            <Store className='mb-3 h-12 w-12 opacity-40' />
            <p>{t('page.empty')}</p>
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {apps.map((app) => (
              <DeployedAppCard key={app.sessionId} app={app} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
