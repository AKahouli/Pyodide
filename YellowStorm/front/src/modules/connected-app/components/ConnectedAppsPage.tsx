import { useEffect } from 'react';
import { Plug } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useConnectedAppStore, useConnectedApps, useConnectedAppsLoading } from '../store';
import { AppCard } from './AppCard';
import { IntegrationsTabs } from './IntegrationsTabs';

export function ConnectedAppsPage() {
  const { t } = useModuleTranslation('connected-app');
  const apps = useConnectedApps();
  const loading = useConnectedAppsLoading();
  const fetchApps = useConnectedAppStore((s) => s.fetchApps);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-6 py-5 border-b">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t('page.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('page.description')}</p>
          </div>
        </div>
        <div className="mt-4">
          <IntegrationsTabs />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && apps.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Plug className="h-12 w-12 mb-3 opacity-40" />
            <p>{t('page.empty')}</p>
          </div>
        ) : (
          <div className="grid gap-3 max-w-2xl">
            {apps.map((app) => (
              <AppCard key={app.appKey} app={app} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
