import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { useAllWorkspaces, useAllSharedWorkspaces, useAllPublicWorkspaces } from '../store';
import type { Workspace, SharedWorkspaceResponse, PublicWorkspaceResponse } from '../types';

const SEARCH_DEBOUNCE_MS = 200;

export type OwnershipFilter = 'all' | 'personal' | 'mine' | 'shared' | 'public';
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
  isPublicItem?: boolean;
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
  public: WorkspaceHubItem[];
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
  counts: { personal: number; mine: number; shared: number; public: number };
}

function isOwnership(value: string | null): value is OwnershipFilter {
  return (
    value === 'all' || value === 'personal' || value === 'mine' ||
    value === 'shared' || value === 'public'
  );
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
    isPublicItem: w.isPublic,
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

function toItemFromPublic(w: PublicWorkspaceResponse): WorkspaceHubItem {
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
    isPersonal: false,
    isReadOnly: true,
    sharedByName: w.owner.firstName || w.owner.email,
    isPublicItem: true,
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
  const ownedWorkspaces = useAllWorkspaces();
  const sharedWorkspaces = useAllSharedWorkspaces();
  const publicWorkspaces = useAllPublicWorkspaces();

  const [searchParams, setSearchParams] = useSearchParams();

  const rawSearch = searchParams.get('q') ?? '';
  const ownerParam = searchParams.get('owner');
  const owner: OwnershipFilter = isOwnership(ownerParam) ? ownerParam : 'all';
  const sortParam = searchParams.get('sort');
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'updated';
  const viewParam = searchParams.get('view');
  const view: ViewMode = isViewMode(viewParam) ? viewParam : 'grid';

  const [searchInput, setSearchInputState] = useState(rawSearch);
  const { schedule, cancel } = useDebouncedCallback();
  const skipNextSyncRef = useRef(false);

  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    setSearchInputState(rawSearch);
  }, [rawSearch]);

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
      schedule(() => {
        skipNextSyncRef.current = true;
        applyParam('q', value.trim());
      }, SEARCH_DEBOUNCE_MS);
    },
    [applyParam, schedule],
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
    cancel();
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
  }, [cancel, setSearchParams]);

  const personalItems = useMemo(
    () => ownedWorkspaces.filter((w) => w.isPersonal).map(toItemFromOwned),
    [ownedWorkspaces],
  );
  const mineItems = useMemo(
    () => ownedWorkspaces.filter((w) => !w.isPersonal).map(toItemFromOwned),
    [ownedWorkspaces],
  );
  const sharedItems = useMemo(() => sharedWorkspaces.map(toItemFromShared), [sharedWorkspaces]);
  const publicItems = useMemo(() => publicWorkspaces.map(toItemFromPublic), [publicWorkspaces]);

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
    const publicGroup =
      owner === 'all' || owner === 'public'
        ? sortItems(publicItems.filter((w) => matches(w, rawSearch)), sort)
        : [];
    return { personal, mine, shared, public: publicGroup };
  }, [personalItems, mineItems, sharedItems, publicItems, rawSearch, owner, sort]);

  const hasActiveFilters = !!rawSearch || owner !== 'all' || sort !== 'updated';
  const isEmpty =
    filteredGroups.personal.length === 0 &&
    filteredGroups.mine.length === 0 &&
    filteredGroups.shared.length === 0 &&
    filteredGroups.public.length === 0;

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
      public: publicItems.length,
    },
  };
}
