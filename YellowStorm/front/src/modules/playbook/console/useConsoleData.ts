import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import * as api from '../api';
import { usePlaybookStore } from '../store';
import { buildPlaybookVM, markDuplicates, type PlaybookVM, type RawPlaybookListItem } from '../utils/playbookVM';
import { PLAYBOOK_SHARED_EVENT } from '../services/playbookStreamService';

const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 4; // ponytail: load-all ceiling of 400 items; virtualise above this
const HISTORY_MAX_PLAYBOOKS = 60; // ponytail: per-playbook history fetch ceiling; aggregate endpoint is the upgrade path
const HISTORY_BATCH = 3;
const ACTIVE_STATUSES = new Set(['queued', 'running', 'pending', 'pending_approval']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/**
 * Loads the whole playbook list (bounded), overlays live executions from the
 * SSE-hydrated store cache, and lazily fills per-playbook run history.
 */
export function useConsoleData() {
  const [rawItems, setRawItems] = useState<RawPlaybookListItem[] | null>(null);
  const rawItemsRef = useRef<RawPlaybookListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  const executionCache = usePlaybookStore(useShallow((s) => s.executionCache));
  const historyByPlaybook = usePlaybookStore(useShallow((s) => s.executionHistoryByPlaybook));
  const historyLoaded = useRef(new Set<string>());

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const first = await api.getPlaybooks({ page: 1, limit: LIST_PAGE_SIZE, sortBy: 'updatedAt', sortOrder: 'desc' });
      let items = first.playbooks as RawPlaybookListItem[];
      const totalPages = Math.min(first.pagination.totalPages ?? 1, MAX_LIST_PAGES);
      for (let page = 2; page <= totalPages; page++) {
        const next = await api.getPlaybooks({ page, limit: LIST_PAGE_SIZE, sortBy: 'updatedAt', sortOrder: 'desc' });
        items = items.concat(next.playbooks as RawPlaybookListItem[]);
      }
      setRawItems(items);
      rawItemsRef.current = items;
      setError(null);
    } catch (err) {
      // Only the first load may replace the page with an error panel; background
      // refreshes keep the stale list (§12: never a blank page over good data).
      const message = err instanceof Error ? err.message : 'Failed to load playbooks';
      if (rawItemsRef.current === null) setError(message);
      else if (import.meta.env.DEV) console.warn('[playbooks-console] background refresh failed:', message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + hydrate active executions so the rail is correct even when
  // the SSE stream is still connecting.
  useEffect(() => {
    void loadAll();
    api.getActiveExecutions()
      .then((execs) => usePlaybookStore.getState().hydrateActiveExecutions(execs))
      .catch(() => { /* SSE will fill in */ });
  }, [loadAll]);

  // Lazy per-playbook history (bounded), concurrency-limited.
  useEffect(() => {
    if (!rawItems?.length) return;
    if (rawItems.length > HISTORY_MAX_PLAYBOOKS) {
      if (import.meta.env.DEV) {
        console.warn('[playbooks-console] run history not loaded: workspace exceeds per-row fetch ceiling; Reliability column degraded');
      }
      return;
    }
    let cancelled = false;
    const ids = rawItems.map((r) => r.id).filter((id) => !historyLoaded.current.has(id));
    (async () => {
      for (let i = 0; i < ids.length; i += HISTORY_BATCH) {
        if (cancelled) return;
        await Promise.all(
          ids.slice(i, i + HISTORY_BATCH).map(async (id) => {
            historyLoaded.current.add(id);
            await usePlaybookStore.getState().fetchExecutions(id).catch(() => {
              // Allow a later run (next refresh) to retry this row.
              historyLoaded.current.delete(id);
            });
          }),
        );
        if (!cancelled) setHistoryTick((t) => t + 1);
      }
      if (!cancelled) {
        // Baseline the terminal-event signature after the prefetch burst so the
        // cache entries fetchExecutions just added do not trigger a refetch.
        lastSignature.current = Object.values(usePlaybookStore.getState().executionCache)
          .map((e) => `${e.id}=${e.status}`)
          .sort()
          .join('|');
      }
    })();
    return () => { cancelled = true; };
  }, [rawItems]);

  // Refresh the list when a run reaches a terminal state (SSE drives the cache),
  // and when the tab becomes visible again.
  const cacheSignature = useMemo(
    () => Object.values(executionCache).map((e) => `${e.id}=${e.status}`).sort().join('|'),
    [executionCache],
  );
  const lastSignature = useRef<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (lastSignature.current === null) {
      lastSignature.current = cacheSignature;
      return;
    }
    if (cacheSignature === lastSignature.current) return;
    const hadTerminal = Object.values(executionCache).some((e) => TERMINAL_STATUSES.has(e.status));
    lastSignature.current = cacheSignature;
    if (!hadTerminal) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void loadAll(true), 600);
  }, [cacheSignature, executionCache, loadAll]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadAll(true);
    };
    const onShared = () => void loadAll(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(PLAYBOOK_SHARED_EVENT, onShared);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(PLAYBOOK_SHARED_EVENT, onShared);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [loadAll]);

  // O(n²) duplicate scan depends only on raw items — keep it out of the
  // SSE-driven VM rebuild path.
  const duplicates = useMemo(() => markDuplicates(rawItems ?? []), [rawItems]);

  const vms = useMemo(() => {
    if (!rawItems) return [];
    void historyTick;
    const activeByPlaybook = new Map<string, (typeof executionCache)[string]>();
    for (const execution of Object.values(executionCache)) {
      if (!ACTIVE_STATUSES.has(execution.status)) continue;
      const existing = activeByPlaybook.get(execution.playbookId);
      if (!existing || execution.updatedAt > existing.updatedAt) activeByPlaybook.set(execution.playbookId, execution);
    }
    return rawItems.map((raw) => {
      const vm = buildPlaybookVM(raw, {
        liveExecution: activeByPlaybook.get(raw.id) ?? null,
        history: historyByPlaybook[raw.id] ?? null,
      });
      vm.duplicateOfId = duplicates.get(raw.id);
      return vm;
    });
  }, [rawItems, executionCache, historyByPlaybook, historyTick, duplicates]);

  /** Optimistic local patch on a raw item (favorite flip, edited name/description). */
  const patchRaw = useCallback((id: string, partial: Partial<RawPlaybookListItem>) => {
    setRawItems((items) => (items ? items.map((item) => (item.id === id ? { ...item, ...partial } : item)) : items));
  }, []);

  return { vms, raws: rawItems, loading: loading && rawItems === null, error, refresh: useCallback(() => loadAll(), [loadAll]), patchRaw };
}
