import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/modules/auth';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import type { HistoryRow } from '../components/chatGroups';

const subscribe = (notify: () => void) => {
  window.addEventListener('storage', notify);
  return () => window.removeEventListener('storage', notify);
};

export const conversationPinKey = (row: Pick<HistoryRow, 'kind' | 'id'>) => `${row.kind}:${row.id}`;

export function usePinnedConversations() {
  const { user } = useAuth();
  const { t } = useModuleTranslation('sidebar');
  const key = user?.id ? `sidebar:pins:${user.id}` : null;
  const read = useCallback(() => {
    try { return key ? localStorage.getItem(key) : null; } catch { return null; }
  }, [key]);
  const saved = useSyncExternalStore(subscribe, read, () => null);
  const pins = useMemo<HistoryRow[]>(() => {
    try {
      const parsed: unknown = JSON.parse(saved ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((row): row is HistoryRow => row && (row.kind === 'v1' || row.kind === 'v2')
        && typeof row.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(row.id)
        && typeof row.title === 'string' && Number.isFinite(row.sortTime))
        .map((row) => ({ kind: row.kind, id: row.id, title: row.title, sortTime: row.sortTime,
          to: `/${row.kind === 'v1' ? 'conversation' : 'studio'}/${row.id}` }));
    } catch { return []; }
  }, [saved]);

  const save = useCallback((rows: HistoryRow[]) => {
    if (!key) return;
    try {
      // Save only navigation metadata, never the conversation payload.
      localStorage.setItem(key, JSON.stringify(rows.map(({ kind, id, title, sortTime }) => ({ kind, id, title, sortTime }))));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    } catch { showError(t('conversations.pinError')); }
  }, [key, t]);

  const unpin = useCallback((row: Pick<HistoryRow, 'kind' | 'id'>) => {
    if (!pins.some((pin) => conversationPinKey(pin) === conversationPinKey(row))) return;
    save(pins.filter((pin) => conversationPinKey(pin) !== conversationPinKey(row)));
  }, [pins, save]);
  const renamePin = useCallback((row: Pick<HistoryRow, 'kind' | 'id'>, title: string) => {
    if (!pins.some((pin) => conversationPinKey(pin) === conversationPinKey(row))) return;
    save(pins.map((pin) => conversationPinKey(pin) === conversationPinKey(row) ? { ...pin, title } : pin));
  }, [pins, save]);
  const togglePin = useCallback((row: HistoryRow) => {
    const exists = pins.some((pin) => conversationPinKey(pin) === conversationPinKey(row));
    save(exists ? pins.filter((pin) => conversationPinKey(pin) !== conversationPinKey(row)) : [...pins, row]);
  }, [pins, save]);

  return { pins, togglePin, unpin, renamePin };
}
