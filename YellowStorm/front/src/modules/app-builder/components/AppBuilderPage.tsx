import { useEffect } from 'react';
import { AlertCircle, AppWindow, Loader2, RefreshCw, Store, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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

function CatalogSkeleton() {
  return (
    <div
      className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
      aria-busy='true'
      aria-label='Loading'
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className='flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card'
        >
          <div className='flex items-start gap-3.5 p-5'>
            <Skeleton className='size-11 shrink-0 rounded-xl' />
            <div className='min-w-0 flex-1 space-y-2.5'>
              <Skeleton className='h-5 w-40' />
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-3 w-24' />
              <div className='flex gap-1.5 pt-1'>
                <Skeleton className='h-5 w-14 rounded-full' />
                <Skeleton className='h-5 w-10 rounded-full' />
              </div>
            </div>
          </div>
          <div className='border-t border-border/50 bg-muted/20 px-3 py-3'>
            <Skeleton className='ml-auto h-8 w-24' />
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const totalApps = deployed.length + shared.length + drafts.length;

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <header className='relative overflow-hidden border-b border-border/60'>
        <div
          className='pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-muted/30'
          aria-hidden
        />
        <div className='relative mx-auto max-w-6xl px-6 pb-7 pt-8 sm:px-10 sm:pb-9 sm:pt-10'>
          <div className='mb-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-sm backdrop-blur-sm'>
            <Store className='size-3.5 text-primary' aria-hidden />
            {t('page.eyebrow')}
          </div>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div className='min-w-0 max-w-2xl'>
              <h1 className='text-3xl font-semibold tracking-tight text-foreground sm:text-4xl'>
                {t('page.title')}
              </h1>
              <p className='mt-2.5 text-sm leading-relaxed text-muted-foreground sm:text-[15px]'>
                {t('page.description')}
              </p>
            </div>
            {!loading && !error && totalApps > 0 ? (
              <p className='shrink-0 text-xs tabular-nums text-muted-foreground sm:pb-1'>
                {totalApps === 1
                  ? t('hub.sections.singleApp')
                  : t('hub.sections.appsCount', { count: totalApps })}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto max-w-6xl space-y-7 px-6 py-7 sm:px-10'>
          {error ? (
            <div className='flex flex-col items-center justify-center gap-4 rounded-2xl border border-fail/20 bg-fail-soft/30 px-6 py-20 text-center'>
              <div className='flex size-12 items-center justify-center rounded-2xl border border-fail/25 bg-card shadow-sm'>
                <AlertCircle className='size-5 text-fail' aria-hidden />
              </div>
              <div className='max-w-sm space-y-1.5'>
                <p className='text-sm font-semibold text-foreground'>{t('page.errorTitle')}</p>
                <p className='text-sm text-muted-foreground'>{t('page.error')}</p>
              </div>
              <Button type='button' variant='outline' size='sm' className='gap-1.5' onClick={() => fetchApps()}>
                <RefreshCw className='size-3.5' aria-hidden />
                {t('page.retry')}
              </Button>
            </div>
          ) : showInitialLoader ? (
            <div className='space-y-6'>
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='size-4 animate-spin' aria-hidden />
                {t('page.loading')}
              </div>
              <CatalogSkeleton />
            </div>
          ) : showGlobalEmpty ? (
            <div className='space-y-6'>
              <AppBuilderCreateWithAgent />
              <div className='flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/80 bg-muted/15 px-6 py-16 text-center'>
                <div className='flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-sm'>
                  <AppWindow className='size-6 text-muted-foreground' aria-hidden />
                </div>
                <div className='max-w-md space-y-1.5'>
                  <p className='text-sm font-semibold text-foreground'>{t('page.emptyTitle')}</p>
                  <p className='text-sm leading-relaxed text-muted-foreground'>{t('page.empty')}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <AppBuilderCreateWithAgent />

              <div className='space-y-1'>
                <p className='text-sm leading-relaxed text-muted-foreground'>
                  {t(APP_BUILDER_TAB_DESCRIPTION_KEYS[filters.filters.tab])}
                </p>
              </div>

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
                aiOnly={filters.filters.aiOnly}
                onAiOnlyChange={filters.setAiOnly}
                hasActiveFilters={filters.hasActiveFilters}
                onClearAll={filters.clearAll}
              />

              {filters.isEmpty ? (
                <div className='flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/80 bg-muted/10 px-6 py-20 text-center'>
                  <div className='flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-sm'>
                    <AppWindow className='size-5 text-muted-foreground' aria-hidden />
                  </div>
                  <div className='max-w-sm space-y-1.5'>
                    <p className='text-sm font-semibold text-foreground'>
                      {filters.hasActiveFilters
                        ? t('hub.filters.noResultsTitle')
                        : t('hub.filters.emptyTitle')}
                    </p>
                    <p className='text-sm leading-relaxed text-muted-foreground'>
                      {filters.hasActiveFilters
                        ? t('hub.filters.noResults')
                        : t(APP_BUILDER_TAB_EMPTY_KEYS[filters.filters.tab])}
                    </p>
                  </div>
                  {filters.hasActiveFilters ? (
                    <Button variant='outline' size='sm' onClick={filters.clearAll}>
                      <X className='mr-1.5 size-3.5' />
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
