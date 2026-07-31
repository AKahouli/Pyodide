import { useEffect, useState } from 'react';
import { fetchConversationSettings } from '../api';
import type { ConversationSettings } from '../types';

const CACHE_MS = 5_000;
let cached: { value: ConversationSettings; expiresAt: number } | null = null;
let pending: Promise<ConversationSettings> | null = null;

function loadSettings(): Promise<ConversationSettings> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (!pending) {
    pending = fetchConversationSettings()
      .then((value) => {
        cached = { value, expiresAt: Date.now() + CACHE_MS };
        return value;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useConversationSettings() {
  const [settings, setSettings] = useState<ConversationSettings | null>(cached?.value ?? null);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}
