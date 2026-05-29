/**
 * Autosave Hook
 * Saves playbook canvas changes after adaptive inactivity windows.
 */

import { useCallback, useEffect, useRef } from 'react';
import { usePlaybookStore, useIsDirty, useIsSaving, useDirtyVersion } from '../store';
import { getUnboundRequiredPorts, hasIncompleteDataBindings } from '../utils/required-port-validation';

const IDLE_DEBOUNCE_MS = 1200;
const ACTIVE_EDIT_DEBOUNCE_MS = 3000;
const MAX_DEBOUNCE_MS = 5000;

function getAdaptiveDebounceMs(params: {
  lastAutosaveDurationMs: number | null;
  autosaveBackoffUntil: number | null;
  lastDirtyAt: number | null;
}): number {
  const now = Date.now();
  let nextDelay = params.lastDirtyAt && now - params.lastDirtyAt < 700
    ? ACTIVE_EDIT_DEBOUNCE_MS
    : IDLE_DEBOUNCE_MS;

  if (params.lastAutosaveDurationMs && params.lastAutosaveDurationMs > 1000) {
    nextDelay = Math.min(nextDelay * 2, MAX_DEBOUNCE_MS);
  }

  if (params.autosaveBackoffUntil && params.autosaveBackoffUntil > now) {
    nextDelay = Math.max(nextDelay, params.autosaveBackoffUntil - now);
  }

  const maxDelay = params.autosaveBackoffUntil && params.autosaveBackoffUntil > now
    ? params.autosaveBackoffUntil - now
    : MAX_DEBOUNCE_MS;

  return Math.min(nextDelay, maxDelay);
}

export function useAutosave() {
  const isDirty = useIsDirty();
  const isSaving = useIsSaving();
  const dirtyVersion = useDirtyVersion();
  const saveCurrentPlaybook = usePlaybookStore((s) => s.saveCurrentPlaybook);
  const setPendingAutosaveAfterCurrent = usePlaybookStore((s) => s.setPendingAutosaveAfterCurrent);
  const lastAutosaveDurationMs = usePlaybookStore((s) => s.lastAutosaveDurationMs);
  const autosaveBackoffUntil = usePlaybookStore((s) => s.autosaveBackoffUntil);
  const hasUnboundRequiredPorts = usePlaybookStore((s) => {
    const playbook = s.currentPlaybook;
    if (!playbook) return false;
    return getUnboundRequiredPorts(playbook.tasks, playbook.dataBindings ?? []).length > 0;
  });
  const hasIncompleteBindings = usePlaybookStore((s) => {
    const playbook = s.currentPlaybook;
    if (!playbook) return false;
    return hasIncompleteDataBindings(playbook.dataBindings ?? []);
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDirtyAtRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
  }, []);

  const doSave = useCallback(() => {
    clearTimer();
    return saveCurrentPlaybook({ reason: 'autosave' });
  }, [clearTimer, saveCurrentPlaybook]);

  useEffect(() => {
    if (!isDirty || dirtyVersion === 0 || hasUnboundRequiredPorts || hasIncompleteBindings) return;

    const now = Date.now();
    const previousDirtyAt = lastDirtyAtRef.current;
    lastDirtyAtRef.current = now;

    if (isSaving) {
      setPendingAutosaveAfterCurrent(true);
      return;
    }

    clearTimer();
    debounceRef.current = setTimeout(doSave, getAdaptiveDebounceMs({
      lastAutosaveDurationMs,
      autosaveBackoffUntil,
      lastDirtyAt: previousDirtyAt,
    }));

    return clearTimer;
  }, [
    autosaveBackoffUntil,
    clearTimer,
    dirtyVersion,
    doSave,
    hasIncompleteBindings,
    hasUnboundRequiredPorts,
    isDirty,
    isSaving,
    lastAutosaveDurationMs,
    setPendingAutosaveAfterCurrent,
  ]);

  // Cleanup on unmount
  useEffect(() => clearTimer, [clearTimer]);

  const saveNow = useCallback(() => {
    if (hasUnboundRequiredPorts || hasIncompleteBindings) return Promise.resolve();
    clearTimer();
    return saveCurrentPlaybook({ reason: 'manual' });
  }, [clearTimer, saveCurrentPlaybook, hasUnboundRequiredPorts, hasIncompleteBindings]);

  return { saveNow, isDirty, isSaving, hasUnboundRequiredPorts, hasIncompleteBindings };
}
