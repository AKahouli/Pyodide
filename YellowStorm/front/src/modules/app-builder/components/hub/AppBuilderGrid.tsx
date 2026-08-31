import { useEffect, useState } from 'react';

import { useModuleTranslation } from '@/modules/localization';
import type { AppSortKey, AppViewMode } from '../../hooks/useAppBuilderFilters';
import { APP_BUILDER_TAB_LIST_HEADING_KEYS } from '../../ticket-i18n';
import type { AppBuilderTab, DeployedApp, DraftApp } from '../../types';
import { DeployedAppCard } from '../DeployedAppCard';
import { DraftAppCard } from '../DraftAppCard';
import { AppBuilderPagination } from './AppBuilderPagination';

export const APP_BUILDER_PAGE_SIZE = 9;

interface AppBuilderGridProps {
  tab: AppBuilderTab;
  deployed: DeployedApp[];
  shared: DeployedApp[];
  drafts: DraftApp[];
  view: AppViewMode;
}

export function AppBuilderGrid({ tab, deployed, shared, drafts, view }: AppBuilderGridProps) {
  const { t } = useModuleTranslation('app-builder');
  const [page, setPage] = useState(1);

  const apps = tab === 'shared' ? shared : tab === 'draft' ? drafts : deployed;
  const totalPages = Math.max(1, Math.ceil(apps.length / APP_BUILDER_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [tab, deployed, shared, drafts]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageStart = (currentPage - 1) * APP_BUILDER_PAGE_SIZE;
  const pageApps = apps.slice(pageStart, pageStart + APP_BUILDER_PAGE_SIZE);

  const layoutClass =
    view === 'grid'
      ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'
      : 'flex flex-col gap-2';

  const countLabel =
    apps.length === 1 ? t('hub.sections.singleApp') : t('hub.sections.appsCount', { count: apps.length });

  return (
    <section className='space-y-4' aria-labelledby='app-builder-list-heading'>
      <header className='flex items-baseline gap-3'>
        <h2
          id='app-builder-list-heading'
          className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'
        >
          {t(APP_BUILDER_TAB_LIST_HEADING_KEYS[tab])}
        </h2>
        <span className='h-px flex-1 bg-border/80' />
        <span className='text-[11px] tabular-nums text-muted-foreground'>{countLabel}</span>
      </header>

      <div className={layoutClass} role='tabpanel'>
        {tab === 'draft'
          ? (pageApps as DraftApp[]).map((app) => (
              <DraftAppCard key={app.sessionId} app={app} view={view} />
            ))
          : (pageApps as DeployedApp[]).map((app) => (
              <DeployedAppCard key={app.sessionId} app={app} view={view} />
            ))}
      </div>

      <AppBuilderPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </section>
  );
}
