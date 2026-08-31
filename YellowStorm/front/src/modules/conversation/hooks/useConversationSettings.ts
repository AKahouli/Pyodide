import { useEffect, useState } from 'react';
import { fetchConversationSettings } from '../api';
import type { ConversationSettings } from '../types';

const CACHE_MS = 5_000;
let cached: { value: ConversationSettings; expiresAt: number } | null = null;
let pending: Promise<ConversationSettings> | null = null;
const listeners = new Set<(value: ConversationSettings | null) => void>();

function notify(value: ConversationSettings | null): void {
  listeners.forEach((listener) => listener(value));
}

export function setCachedConversationSettings(value: ConversationSettings): void {
  cached = { value, expiresAt: Date.now() + CACHE_MS };
  notify(value);
}

function loadSettings(): Promise<ConversationSettings> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (!pending) {
    pending = fetchConversationSettings()
      .then((value) => {
        setCachedConversationSettings(value);
        return value;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useConversationSettings() {
  const [settings, setSettings] = useState<ConversationSettings | null>(() =>
    cached && cached.expiresAt > Date.now() ? cached.value : null,
  );

  useEffect(() => {
    let cancelled = false;
    const update = (value: ConversationSettings | null) => {
      if (!cancelled) setSettings(value);
    };
    const refresh = () => {
      if (cached && cached.expiresAt > Date.now()) return;
      void loadSettings().catch(() => update(null));
    };
    listeners.add(update);
    refresh();
    const interval = window.setInterval(refresh, CACHE_MS);
    return () => {
      cancelled = true;
      listeners.delete(update);
      window.clearInterval(interval);
    };
  }, []);

  return settings;
}
