/**
 * useAllowedUploadExtensions
 *
 * Returns the current list of file extensions authorized for upload, fetched
 * from the admin-managed global setting. Backed by a shared in-module cache
 * so multiple upload UIs on the same page trigger a single network request.
 * Call `refresh()` after admin saves to refetch and propagate the change.
 */

import { useEffect, useState, useCallback } from 'react';
import { getWorkspaceUploadSettings, type WorkspaceUploadSettings } from '../api';

const FALLBACK_EXTENSIONS = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.html,.htm,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip,.eml';

interface SharedState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  settings: WorkspaceUploadSettings | null;
  error: unknown;
}

const initialState: SharedState = { status: 'idle', settings: null, error: null };

let sharedState: SharedState = initialState;
const subscribers = new Set<() => void>();

function emit(): void {
  for (const notify of subscribers) notify();
}

async function loadSettings(): Promise<void> {
  if (sharedState.status === 'loading') return;
  sharedState = { ...sharedState, status: 'loading', error: null };
  emit();
  try {
    const settings = await getWorkspaceUploadSettings();
    sharedState = { status: 'ready', settings, error: null };
  } catch (error) {
    sharedState = { status: 'error', settings: sharedState.settings, error };
  } finally {
    emit();
  }
}

/**
 * Test-only escape hatch — reset the in-module cache between tests.
 * Not part of the public surface.
 */
export function __resetAllowedUploadExtensionsCache(): void {
  sharedState = initialState;
  emit();
}

export interface UseAllowedUploadExtensionsResult {
  allowedExtensions: string[];
  accept: string;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

export function useAllowedUploadExtensions(): UseAllowedUploadExtensionsResult {
  const [, setTick] = useState(0);

  useEffect(() => {
    const subscribe = (): void => setTick((value) => value + 1);
    subscribers.add(subscribe);
    if (sharedState.status === 'idle') {
      void loadSettings();
    }
    return () => {
      subscribers.delete(subscribe);
    };
  }, []);

  const refresh = useCallback(async () => {
    sharedState = { ...sharedState, status: 'loading', error: null };
    emit();
    try {
      const settings = await getWorkspaceUploadSettings();
      sharedState = { status: 'ready', settings, error: null };
    } catch (error) {
      sharedState = { status: 'error', settings: sharedState.settings, error };
    } finally {
      emit();
    }
  }, []);

  const allowedExtensions = sharedState.settings?.allowedExtensions ?? [];
  const accept = allowedExtensions.length > 0 ? allowedExtensions.join(',') : FALLBACK_EXTENSIONS;
  const isLoading = sharedState.status === 'idle' || sharedState.status === 'loading';

  return {
    allowedExtensions,
    accept,
    isLoading,
    error: sharedState.error,
    refresh,
  };
}
