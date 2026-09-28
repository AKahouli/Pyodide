import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { usePersonalAgents, useDefaultAgents, useSharedAgents } from '../store';
import type { Agent } from '../types';

const SEARCH_DEBOUNCE_MS = 200;

export type OwnershipFilter = 'all' | 'mine' | 'default' | 'shared';
export type SortKey = 'updated' | 'created' | 'name';
export type ViewMode = 'grid' | 'list';

export interface AgentHubFilters {
  search: string;
  type: string;
  owner: OwnershipFilter;
  sort: SortKey;
  view: ViewMode;
}

export interface AgentHubFilteredGroups {
  personal: Agent[];
  defaults: Agent[];
  shared: Agent[];
}

export interface UseAgentHubFiltersResult {
  filters: AgentHubFilters;
  searchInput: string;
  setSearchInput: (value: string) => void;
  setType: (value: string) => void;
  setOwner: (value: OwnershipFilter) => void;
  setSort: (value: SortKey) => void;
  setView: (value: ViewMode) => void;
  clearAll: () => void;
  hasActiveFilters: boolean;
  filteredGroups: AgentHubFilteredGroups;
  isEmpty: boolean;
}

function isOwnership(value: string | null): value is OwnershipFilter {
  return value === 'all' || value === 'mine' || value === 'default' || value === 'shared';
}

function isSortKey(value: string | null): value is SortKey {
  return value === 'updated' || value === 'created' || value === 'name';
}

function isViewMode(value: string | null): value is ViewMode {
  return value === 'grid' || value === 'list';
}

function matches(agent: Agent, search: string, type: string): boolean {
  if (type && agent.agentType?.id !== type) return false;
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    agent.name.toLowerCase().includes(needle) ||
    (agent.role?.toLowerCase().includes(needle) ?? false) ||
    (agent.description?.toLowerCase().includes(needle) ?? false)
  );
}

function sortAgents(list: Agent[], sort: SortKey): Agent[] {
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

export function useAgentHubFilters(): UseAgentHubFiltersResult {
  const personalAgents = usePersonalAgents();
  const defaultAgents = useDefaultAgents();
  const sharedAgents = useSharedAgents();

  const [searchParams, setSearchParams] = useSearchParams();

  const rawSearch = searchParams.get('q') ?? '';
  const type = searchParams.get('type') ?? '';
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

  const setType = useCallback((value: string) => applyParam('type', value), [applyParam]);

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
        next.delete('type');
        next.delete('owner');
        next.delete('sort');
        return next;
      },
      { replace: true },
    );
  }, [cancel, setSearchParams]);

  const filters: AgentHubFilters = useMemo(
    () => ({ search: rawSearch, type, owner, sort, view }),
    [rawSearch, type, owner, sort, view],
  );

  const filteredGroups: AgentHubFilteredGroups = useMemo(() => {
    const personal =
      owner === 'all' || owner === 'mine'
        ? sortAgents(personalAgents.filter((a) => matches(a, rawSearch, type)), sort)
        : [];
    const defaults =
      owner === 'all' || owner === 'default'
        ? sortAgents(defaultAgents.filter((a) => matches(a, rawSearch, type)), sort)
        : [];
    const shared =
      owner === 'all' || owner === 'shared'
        ? sortAgents(sharedAgents.filter((a) => matches(a, rawSearch, type)), sort)
        : [];
    return { personal, defaults, shared };
  }, [personalAgents, defaultAgents, sharedAgents, rawSearch, type, owner, sort]);

  const hasActiveFilters = !!rawSearch || !!type || owner !== 'all' || sort !== 'updated';
  const isEmpty =
    filteredGroups.personal.length === 0 &&
    filteredGroups.defaults.length === 0 &&
    filteredGroups.shared.length === 0;

  return {
    filters,
    searchInput,
    setSearchInput,
    setType,
    setOwner,
    setSort,
    setView,
    clearAll,
    hasActiveFilters,
    filteredGroups,
    isEmpty,
  };
}
