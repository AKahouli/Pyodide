import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'recent-connectors';
const MAX_RECENT = 5;

/** Cross-instance change notification (the native `storage` event only fires in other tabs). */
const EVENT_NAME = 'recent-connectors:change';

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // ignore quota / serialization failures — recents are best-effort
  }
}

/**
 * Tracks the connector IDs the user has most recently used, persisted in
 * localStorage (most-recent first, capped at {@link MAX_RECENT}). Reactive across
 * hook instances in the same tab and across tabs.
 */
export function useRecentConnectors() {
  const [recentIds, setRecentIds] = useState<string[]>(() => readIds());

  useEffect(() => {
    const sync = () => setRecentIds(readIds());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const addRecent = useCallback((id: string) => {
    if (!id) return;
    const next = [id, ...readIds().filter((existing) => existing !== id)];
    writeIds(next);
    setRecentIds(next.slice(0, MAX_RECENT));
  }, []);

  return { recentIds, addRecent };
}
