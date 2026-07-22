import { useModuleTranslation } from '@/modules/localization';
import type { AppMarketplaceFilteredGroups, AppViewMode } from '../../hooks/useAppMarketplaceFilters';
import { DeployedAppCard } from '../DeployedAppCard';

interface AppMarketplaceGridProps {
  groups: AppMarketplaceFilteredGroups;
  view: AppViewMode;
  showSections: boolean;
}

export function AppMarketplaceGrid({ groups, view, showSections }: AppMarketplaceGridProps) {
  const { t } = useModuleTranslation('app-marketplace');

  const sections = [
    { key: 'owned', title: t('hub.sections.personal'), apps: groups.owned },
    { key: 'shared', title: t('hub.sections.shared'), apps: groups.shared },
  ];

  const layoutClass =
    view === 'grid'
      ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'
      : 'flex flex-col gap-2';

  if (!showSections) {
    const apps = [...groups.owned, ...groups.shared];
    return (
      <div className={layoutClass}>
        {apps.map((app) => (
          <DeployedAppCard key={app.sessionId} app={app} />
        ))}
      </div>
    );
  }

  return (
    <div className='space-y-10'>
      {sections.map((section) =>
        section.apps.length > 0 ? (
          <section key={section.key} className='space-y-4'>
            <header className='flex items-baseline gap-3'>
              <h2 className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
                {section.title}
              </h2>
              <span className='h-px flex-1 bg-border/80' />
              <span className='text-[11px] tabular-nums text-muted-foreground'>
                {section.apps.length === 1
                  ? t('hub.sections.singleApp')
                  : t('hub.sections.appsCount', { count: section.apps.length })}
              </span>
            </header>
            <div className={layoutClass}>
              {section.apps.map((app) => (
                <DeployedAppCard key={app.sessionId} app={app} />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
