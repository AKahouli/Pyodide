import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DeployedApp } from '../types';

const SEARCH_DEBOUNCE_MS = 200;

export type AppOwnershipFilter = 'all' | 'owned' | 'shared';
export type AppSortKey = 'deployed' | 'name';
export type AppViewMode = 'grid' | 'list';

export interface AppBuilderFilterState {
  search: string;
  owner: AppOwnershipFilter;
  sort: AppSortKey;
  view: AppViewMode;
}

export interface AppBuilderFilteredGroups {
  owned: DeployedApp[];
  shared: DeployedApp[];
}

function isOwnership(value: string | null): value is AppOwnershipFilter {
  return value === 'all' || value === 'owned' || value === 'shared';
}

function isSortKey(value: string | null): value is AppSortKey {
  return value === 'deployed' || value === 'name';
}

function isViewMode(value: string | null): value is AppViewMode {
  return value === 'grid' || value === 'list';
}

function matches(app: DeployedApp, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    app.title.toLowerCase().includes(needle) ||
    app.deployedUrl.toLowerCase().includes(needle)
  );
}

function sortApps(list: DeployedApp[], sort: AppSortKey): DeployedApp[] {
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

export function useAppBuilderFilters(apps: DeployedApp[]) {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawSearch = searchParams.get('q') ?? '';
  const ownerParam = searchParams.get('owner');
  const owner: AppOwnershipFilter = isOwnership(ownerParam) ? ownerParam : 'all';
  const sortParam = searchParams.get('sort');
  const sort: AppSortKey = isSortKey(sortParam) ? sortParam : 'deployed';
  const viewParam = searchParams.get('view');
  const view: AppViewMode = isViewMode(viewParam) ? viewParam : 'grid';

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

  const setOwner = useCallback(
    (value: AppOwnershipFilter) => applyParam('owner', value === 'all' ? '' : value),
    [applyParam],
  );

  const setSort = useCallback(
    (value: AppSortKey) => applyParam('sort', value === 'deployed' ? '' : value),
    [applyParam],
  );

  const setView = useCallback(
    (value: AppViewMode) => applyParam('view', value === 'grid' ? '' : value),
    [applyParam],
  );

  const clearAll = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInputState('');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('q');
        next.delete('owner');
        next.delete('sort');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const filters: AppBuilderFilterState = useMemo(
    () => ({ search: rawSearch, owner, sort, view }),
    [rawSearch, owner, sort, view],
  );

  const ownedApps = useMemo(
    () => apps.filter((app) => app.source === 'owned'),
    [apps],
  );
  const sharedApps = useMemo(
    () => apps.filter((app) => app.source === 'shared'),
    [apps],
  );

  const filteredGroups: AppBuilderFilteredGroups = useMemo(() => {
    const owned =
      owner === 'all' || owner === 'owned'
        ? sortApps(ownedApps.filter((app) => matches(app, rawSearch)), sort)
        : [];
    const shared =
      owner === 'all' || owner === 'shared'
        ? sortApps(sharedApps.filter((app) => matches(app, rawSearch)), sort)
        : [];
    return { owned, shared };
  }, [ownedApps, sharedApps, rawSearch, owner, sort]);

  const hasActiveFilters = !!rawSearch || owner !== 'all' || sort !== 'deployed';
  const isEmpty = filteredGroups.owned.length === 0 && filteredGroups.shared.length === 0;
  const visibleApps = useMemo(
    () => [...filteredGroups.owned, ...filteredGroups.shared],
    [filteredGroups],
  );

  return {
    filters,
    searchInput,
    setSearchInput,
    setOwner,
    setSort,
    setView,
    clearAll,
    hasActiveFilters,
    filteredGroups,
    isEmpty,
    visibleApps,
  };
}
