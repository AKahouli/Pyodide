import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useWorkspaces, useSharedWorkspaces } from '../store';
import type { Workspace, SharedWorkspaceResponse } from '../types';

const SEARCH_DEBOUNCE_MS = 200;

export type OwnershipFilter = 'all' | 'personal' | 'mine' | 'shared';
export type SortKey = 'updated' | 'created' | 'name';
export type ViewMode = 'grid' | 'list';

/**
 * Normalised shape so the hub cards/grid can render owned and shared
 * workspaces uniformly (the two sources have different fields).
 */
export interface WorkspaceHubItem {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  createdAt: string;
  updatedAt: string;
  isShared: boolean;
  isPersonal: boolean;
  isReadOnly: boolean;
  sharedByName?: string;
  shareCount?: number;
}

export interface WorkspaceHubFilters {
  search: string;
  owner: OwnershipFilter;
  sort: SortKey;
  view: ViewMode;
}

export interface WorkspaceHubFilteredGroups {
  personal: WorkspaceHubItem[];
  mine: WorkspaceHubItem[];
  shared: WorkspaceHubItem[];
}

export interface UseWorkspaceHubFiltersResult {
  filters: WorkspaceHubFilters;
  searchInput: string;
  setSearchInput: (value: string) => void;
  setOwner: (value: OwnershipFilter) => void;
  setSort: (value: SortKey) => void;
  setView: (value: ViewMode) => void;
  clearAll: () => void;
  hasActiveFilters: boolean;
  filteredGroups: WorkspaceHubFilteredGroups;
  isEmpty: boolean;
  counts: { personal: number; mine: number; shared: number };
}

function isOwnership(value: string | null): value is OwnershipFilter {
  return value === 'all' || value === 'personal' || value === 'mine' || value === 'shared';
}

function isSortKey(value: string | null): value is SortKey {
  return value === 'updated' || value === 'created' || value === 'name';
}

function isViewMode(value: string | null): value is ViewMode {
  return value === 'grid' || value === 'list';
}

function toItemFromOwned(w: Workspace): WorkspaceHubItem {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    documentCount: w.documentCount,
    usedStorage: w.usedStorage,
    allocatedStorage: w.allocatedStorage,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    isShared: false,
    isPersonal: w.isPersonal,
    isReadOnly: false,
    shareCount: w.shareCount,
  };
}

function toItemFromShared(w: SharedWorkspaceResponse): WorkspaceHubItem {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    documentCount: w.documentCount,
    usedStorage: w.usedStorage,
    allocatedStorage: w.allocatedStorage,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    isShared: true,
    isPersonal: false,
    isReadOnly: w.permission === 'read',
    sharedByName: w.owner.firstName || w.owner.email,
  };
}

function matches(item: WorkspaceHubItem, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.description?.toLowerCase().includes(needle) ?? false)
  );
}

function sortItems(list: WorkspaceHubItem[], sort: SortKey): WorkspaceHubItem[] {
  const copy = [...list];
  if (sort === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'created') {
    copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  return copy;
}

export function useWorkspaceHubFilters(): UseWorkspaceHubFiltersResult {
  const ownedWorkspaces = useWorkspaces();
  const sharedWorkspaces = useSharedWorkspaces();

  const [searchParams, setSearchParams] = useSearchParams();

  const rawSearch = searchParams.get('q') ?? '';
  const ownerParam = searchParams.get('owner');
  const owner: OwnershipFilter = isOwnership(ownerParam) ? ownerParam : 'all';
  const sortParam = searchParams.get('sort');
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'updated';
  const viewParam = searchParams.get('view');
  const view: ViewMode = isViewMode(viewParam) ? viewParam : 'grid';

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
    (value: OwnershipFilter) => applyParam('owner', value === 'all' ? '' : value),
    [applyParam],
  );

  const setSort = useCallback(
    (value: SortKey) => applyParam('sort', value === 'updated' ? '' : value),
    [applyParam],
  );

  const setView = useCallback(
    (value: ViewMode) => applyParam('view', value === 'grid' ? '' : value),
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

  const personalItems = useMemo(
    () => ownedWorkspaces.filter((w) => w.isPersonal).map(toItemFromOwned),
    [ownedWorkspaces],
  );
  const mineItems = useMemo(
    () => ownedWorkspaces.filter((w) => !w.isPersonal).map(toItemFromOwned),
    [ownedWorkspaces],
  );
  const sharedItems = useMemo(() => sharedWorkspaces.map(toItemFromShared), [sharedWorkspaces]);

  const filters: WorkspaceHubFilters = useMemo(
    () => ({ search: rawSearch, owner, sort, view }),
    [rawSearch, owner, sort, view],
  );

  const filteredGroups: WorkspaceHubFilteredGroups = useMemo(() => {
    const personal =
      owner === 'all' || owner === 'personal'
        ? sortItems(personalItems.filter((w) => matches(w, rawSearch)), sort)
        : [];
    const mine =
      owner === 'all' || owner === 'mine'
        ? sortItems(mineItems.filter((w) => matches(w, rawSearch)), sort)
        : [];
    const shared =
      owner === 'all' || owner === 'shared'
        ? sortItems(sharedItems.filter((w) => matches(w, rawSearch)), sort)
        : [];
    return { personal, mine, shared };
  }, [personalItems, mineItems, sharedItems, rawSearch, owner, sort]);

  const hasActiveFilters = !!rawSearch || owner !== 'all' || sort !== 'updated';
  const isEmpty =
    filteredGroups.personal.length === 0 &&
    filteredGroups.mine.length === 0 &&
    filteredGroups.shared.length === 0;

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
    counts: {
      personal: personalItems.length,
      mine: mineItems.length,
      shared: sharedItems.length,
    },
  };
}
