/**
 * Autosave Hook
 * Saves playbook canvas changes after 1000ms of inactivity (debounced).
 */

import { useCallback, useEffect, useRef } from 'react';
import { usePlaybookStore, useIsDirty, useIsSaving, useDirtyVersion } from '../store';

const DEBOUNCE_MS = 1000;

export function useAutosave() {
  const isDirty = useIsDirty();
  const isSaving = useIsSaving();
  const dirtyVersion = useDirtyVersion();
  const saveCurrentPlaybook = usePlaybookStore((s) => s.saveCurrentPlaybook);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
  }, []);

  const doSave = useCallback(() => {
    clearTimer();
    return saveCurrentPlaybook();
  }, [clearTimer, saveCurrentPlaybook]);

  useEffect(() => {
    if (!isDirty || isSaving || dirtyVersion === 0) return;

    clearTimer();
    debounceRef.current = setTimeout(doSave, DEBOUNCE_MS);

    return clearTimer;
  }, [dirtyVersion, isDirty, isSaving, doSave, clearTimer]);

  // Cleanup on unmount
  useEffect(() => clearTimer, [clearTimer]);

  const saveNow = useCallback(() => {
    clearTimer();
    return saveCurrentPlaybook();
  }, [clearTimer, saveCurrentPlaybook]);

  return { saveNow, isDirty, isSaving };
}
