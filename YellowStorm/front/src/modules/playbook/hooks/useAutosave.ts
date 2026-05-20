/**
 * Autosave Hook
 * Saves playbook canvas changes after 1000ms of inactivity (debounced).
 */

import { useCallback, useEffect, useRef } from 'react';
import { usePlaybookStore, useIsDirty, useIsSaving, useDirtyVersion } from '../store';
import { getUnboundRequiredPorts } from '../utils/required-port-validation';

const DEBOUNCE_MS = 1000;

export function useAutosave() {
  const isDirty = useIsDirty();
  const isSaving = useIsSaving();
  const dirtyVersion = useDirtyVersion();
  const saveCurrentPlaybook = usePlaybookStore((s) => s.saveCurrentPlaybook);
  const hasUnboundRequiredPorts = usePlaybookStore((s) => {
    const playbook = s.currentPlaybook;
    if (!playbook) return false;
    return getUnboundRequiredPorts(playbook.tasks, playbook.dataBindings ?? []).length > 0;
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
  }, []);

  const doSave = useCallback(() => {
    clearTimer();
    return saveCurrentPlaybook();
  }, [clearTimer, saveCurrentPlaybook]);

  useEffect(() => {
    if (!isDirty || isSaving || dirtyVersion === 0 || hasUnboundRequiredPorts) return;

    clearTimer();
    debounceRef.current = setTimeout(doSave, DEBOUNCE_MS);

    return clearTimer;
  }, [dirtyVersion, isDirty, isSaving, doSave, clearTimer]);

  // Cleanup on unmount
  useEffect(() => clearTimer, [clearTimer]);

  const saveNow = useCallback(() => {
    if (hasUnboundRequiredPorts) return Promise.resolve();
    clearTimer();
    return saveCurrentPlaybook();
  }, [clearTimer, saveCurrentPlaybook, hasUnboundRequiredPorts]);

  return { saveNow, isDirty, isSaving, hasUnboundRequiredPorts };
}
