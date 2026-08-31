import { useEffect } from 'react';
import { AppWindow, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useAppBuilderFilters } from '../hooks/useAppBuilderFilters';
import {
  APP_BUILDER_TAB_DESCRIPTION_KEYS,
  APP_BUILDER_TAB_EMPTY_KEYS,
} from '../status-i18n';
import { useAppBuilderStore } from '../store';
import { AppBuilderCreateWithAgent } from './hub/AppBuilderCreateWithAgent';
import { AppBuilderFilters } from './hub/AppBuilderFilters';
import { AppBuilderGrid } from './hub/AppBuilderGrid';

export function AppBuilderPage() {
  const { t } = useModuleTranslation('app-builder');
  const deployed = useAppBuilderStore((s) => s.deployed);
  const shared = useAppBuilderStore((s) => s.shared);
  const drafts = useAppBuilderStore((s) => s.drafts);
  const loading = useAppBuilderStore((s) => s.loading);
  const error = useAppBuilderStore((s) => s.error);
  const fetchApps = useAppBuilderStore((s) => s.fetchApps);

  const catalog = { deployed, shared, drafts };
  const filters = useAppBuilderFilters(catalog);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  const showInitialLoader = loading && filters.isCatalogEmpty;
  const showGlobalEmpty = !loading && !error && filters.isCatalogEmpty;

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <header className='relative border-b border-border/60 px-6 pb-6 pt-8 sm:px-10 sm:pb-8 sm:pt-10'>
        <div className='mx-auto max-w-6xl'>
          <div className='min-w-0'>
            <div className='mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground'>
              <AppWindow className='h-3 w-3' />
              {t('button.label')}
            </div>
            <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>{t('page.title')}</h1>
            <p className='mt-2 max-w-xl text-sm text-muted-foreground'>{t('page.description')}</p>
          </div>
        </div>
      </header>

      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto max-w-6xl space-y-6 px-6 py-6 sm:px-10'>
          {error ? (
            <div className='flex flex-col items-center justify-center py-20 text-muted-foreground'>
              <p>{t('page.error')}</p>
            </div>
          ) : showInitialLoader ? (
            <div className='flex items-center justify-center py-24'>
              <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
            </div>
          ) : showGlobalEmpty ? (
            <div className='space-y-6'>
              <AppBuilderCreateWithAgent />
              <div className='flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 py-16 text-center'>
                <div className='flex h-12 w-12 items-center justify-center rounded-full bg-muted/60'>
                  <AppWindow className='h-5 w-5 text-muted-foreground' />
                </div>
                <p className='max-w-sm text-sm text-muted-foreground'>{t('page.empty')}</p>
              </div>
            </div>
          ) : (
            <>
              <AppBuilderCreateWithAgent />

              <p className='text-sm text-muted-foreground'>
                {t(APP_BUILDER_TAB_DESCRIPTION_KEYS[filters.filters.tab])}
              </p>

              <AppBuilderFilters
                searchInput={filters.searchInput}
                onSearchChange={filters.setSearchInput}
                tab={filters.filters.tab}
                onTabChange={filters.setTab}
                tabCounts={filters.tabCounts}
                sort={filters.filters.sort}
                onSortChange={filters.setSort}
                view={filters.filters.view}
                onViewChange={filters.setView}
                hasActiveFilters={filters.hasActiveFilters}
                onClearAll={filters.clearAll}
              />

              {filters.isEmpty ? (
                <div className='flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 py-20 text-center'>
                  <div className='flex h-12 w-12 items-center justify-center rounded-full bg-muted/60'>
                    <AppWindow className='h-5 w-5 text-muted-foreground' />
                  </div>
                  <p className='max-w-sm text-sm text-muted-foreground'>
                    {filters.hasActiveFilters
                      ? t('hub.filters.noResults')
                      : t(APP_BUILDER_TAB_EMPTY_KEYS[filters.filters.tab])}
                  </p>
                  {filters.hasActiveFilters ? (
                    <Button variant='outline' size='sm' onClick={filters.clearAll}>
                      <X className='mr-1.5 h-3.5 w-3.5' />
                      {t('hub.filters.clear')}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <AppBuilderGrid
                  tab={filters.filters.tab}
                  deployed={filters.filteredDeployed}
                  shared={filters.filteredShared}
                  drafts={filters.filteredDrafts}
                  all={filters.filteredAll}
                  view={filters.filters.view}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
