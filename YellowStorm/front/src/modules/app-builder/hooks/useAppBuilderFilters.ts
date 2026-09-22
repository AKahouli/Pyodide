import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  AppBuilderCatalog,
  AppBuilderTab,
  AppCatalogItem,
  DeployedApp,
  DraftApp,
} from '../types';

const SEARCH_DEBOUNCE_MS = 200;

export type AppSortKey = 'deployed' | 'name' | 'updated';
export type AppViewMode = 'grid' | 'list';

export interface AppBuilderFilterState {
  search: string;
  tab: AppBuilderTab;
  sort: AppSortKey;
  view: AppViewMode;
  aiOnly: boolean;
}

function isTab(value: string | null): value is AppBuilderTab {
  return value === 'all' || value === 'deployed' || value === 'shared' || value === 'draft';
}

function isSortKey(value: string | null): value is AppSortKey {
  return value === 'deployed' || value === 'name' || value === 'updated';
}

function isViewMode(value: string | null): value is AppViewMode {
  return value === 'grid' || value === 'list';
}

function hasAiFeatures(app: DeployedApp | DraftApp): boolean {
  return app.hasAiFeatures === true;
}

function matchesDeployed(app: DeployedApp, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    app.title.toLowerCase().includes(needle) ||
    app.deployedUrl.toLowerCase().includes(needle)
  );
}

function matchesDraft(app: DraftApp, search: string): boolean {
  if (!search) return true;
  return app.title.toLowerCase().includes(search.toLowerCase());
}

function sortDeployed(list: DeployedApp[], sort: AppSortKey): DeployedApp[] {
  const copy = [...list];
  if (sort === 'name') {
    copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else {
    copy.sort(
      (a, b) =>
        new Date(b.lastDeployedAt ?? 0).getTime() - new Date(a.lastDeployedAt ?? 0).getTime(),
    );
  }
  return copy;
}

function sortDrafts(list: DraftApp[], sort: AppSortKey): DraftApp[] {
  const copy = [...list];
  if (sort === 'name') {
    copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else {
    copy.sort(
      (a, b) =>
        new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime(),
    );
  }
  return copy;
}

function catalogItemDate(item: AppCatalogItem): number {
  if (item.kind === 'draft') {
    return new Date(item.app.lastUpdatedAt).getTime();
  }
  return new Date(item.app.lastDeployedAt ?? 0).getTime();
}

function sortCatalogItems(items: AppCatalogItem[], sort: AppSortKey): AppCatalogItem[] {
  const copy = [...items];
  if (sort === 'name') {
    copy.sort((a, b) => (a.app.title || '').localeCompare(b.app.title || ''));
  } else {
    copy.sort((a, b) => catalogItemDate(b) - catalogItemDate(a));
  }
  return copy;
}

export function useAppBuilderFilters(catalog: AppBuilderCatalog) {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawSearch = searchParams.get('q') ?? '';
  const tabParam = searchParams.get('tab');
  const tab: AppBuilderTab = isTab(tabParam) ? tabParam : 'all';
  const sortParam = searchParams.get('sort');
  const defaultSort: AppSortKey = tab === 'draft' ? 'updated' : 'deployed';
  const sort: AppSortKey = isSortKey(sortParam) ? sortParam : defaultSort;
  const viewParam = searchParams.get('view');
  const view: AppViewMode = isViewMode(viewParam) ? viewParam : 'grid';
  const aiOnly = searchParams.get('ai') === '1';

  const [searchInput, setSearchInputState] = useState(rawSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSyncRef = useRef(false);

  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    setSearchInputState(rawSearch);
  }, [rawSearch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const applyParam = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSearchInput = useCallback(
    (value: string) => {
      setSearchInputState(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        skipNextSyncRef.current = true;
        applyParam('q', value.trim());
      }, SEARCH_DEBOUNCE_MS);
    },
    [applyParam],
  );

  const setTab = useCallback(
    (value: AppBuilderTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === 'all') next.delete('tab');
          else next.set('tab', value);
          if (value === 'draft' && (!sortParam || sortParam === 'deployed')) {
            next.set('sort', 'updated');
          } else if (value !== 'draft' && sortParam === 'updated') {
            next.delete('sort');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, sortParam],
  );

  const setSort = useCallback(
    (value: AppSortKey) => {
      const isDefault = value === (tab === 'draft' ? 'updated' : 'deployed');
      applyParam('sort', isDefault ? '' : value);
    },
    [applyParam, tab],
  );

  const setView = useCallback(
    (value: AppViewMode) => applyParam('view', value === 'grid' ? '' : value),
    [applyParam],
  );

  const setAiOnly = useCallback(
    (value: boolean) => applyParam('ai', value ? '1' : ''),
    [applyParam],
  );

  const clearAll = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInputState('');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('q');
        next.delete('sort');
        next.delete('ai');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const filters: AppBuilderFilterState = useMemo(
    () => ({ search: rawSearch, tab, sort, view, aiOnly }),
    [rawSearch, tab, sort, view, aiOnly],
  );

  const filteredDeployed = useMemo(
    () =>
      sortDeployed(
        catalog.deployed.filter(
          (app) => matchesDeployed(app, rawSearch) && (!aiOnly || hasAiFeatures(app)),
        ),
        sort,
      ),
    [catalog.deployed, rawSearch, sort, aiOnly],
  );

  const filteredShared = useMemo(
    () =>
      sortDeployed(
        catalog.shared.filter(
          (app) => matchesDeployed(app, rawSearch) && (!aiOnly || hasAiFeatures(app)),
        ),
        sort,
      ),
    [catalog.shared, rawSearch, sort, aiOnly],
  );

  const filteredDrafts = useMemo(
    () =>
      sortDrafts(
        catalog.drafts.filter(
          (app) => matchesDraft(app, rawSearch) && (!aiOnly || hasAiFeatures(app)),
        ),
        sort,
      ),
    [catalog.drafts, rawSearch, sort, aiOnly],
  );

  const filteredAll = useMemo(
    () =>
      sortCatalogItems(
        [
          ...filteredDeployed.map((app) => ({ kind: 'deployed' as const, app })),
          ...filteredShared.map((app) => ({ kind: 'deployed' as const, app })),
          ...filteredDrafts.map((app) => ({ kind: 'draft' as const, app })),
        ],
        sort,
      ),
    [filteredDeployed, filteredShared, filteredDrafts, sort],
  );

  const tabCounts = useMemo(
    () => ({
      all: catalog.deployed.length + catalog.shared.length + catalog.drafts.length,
      deployed: catalog.deployed.length,
      shared: catalog.shared.length,
      draft: catalog.drafts.length,
    }),
    [catalog],
  );

  const activeList = useMemo(() => {
    if (tab === 'all') return filteredAll;
    if (tab === 'shared') return filteredShared;
    if (tab === 'draft') return filteredDrafts;
    return filteredDeployed;
  }, [tab, filteredAll, filteredDeployed, filteredShared, filteredDrafts]);

  const hasActiveFilters = !!rawSearch || sort !== defaultSort || aiOnly;
  const isEmpty = activeList.length === 0;
  const isCatalogEmpty =
    catalog.deployed.length === 0 &&
    catalog.shared.length === 0 &&
    catalog.drafts.length === 0;

  return {
    filters,
    searchInput,
    setSearchInput,
    setTab,
    setSort,
    setView,
    setAiOnly,
    clearAll,
    hasActiveFilters,
    tabCounts,
    filteredDeployed,
    filteredShared,
    filteredDrafts,
    filteredAll,
    activeList,
    isEmpty,
    isCatalogEmpty,
  };
}
