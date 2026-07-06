import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'workspace:deep-search-indexation';

export function readDeepSearchIndexationValue(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useDeepSearchIndexation() {
  const [enabled, setEnabledState] = useState<boolean>(() => readDeepSearchIndexationValue());

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setEnabledState(readDeepSearchIndexationValue());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
    }
  }, []);

  return { enabled, setEnabled };
}
