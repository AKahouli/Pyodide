/**
 * Autosave Hook
 * Saves playbook canvas changes after adaptive inactivity windows.
 */

import { useCallback, useEffect, useRef } from 'react';
import { parseApiError } from '@/lib/api-error';
import { ErrorCode } from '@/lib/error-codes';
import { usePlaybookStore, useIsDirty, useIsSaving, useDirtyVersion } from '../store';
import { getUnboundRequiredPorts, hasIncompleteDataBindings } from '../utils/required-port-validation';
import { playbookFeatures } from '../features';
import { useAutosaveActor } from '../machines/autosave/useAutosaveActor';

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
  const autosaveActor = useAutosaveActor(playbookFeatures.xstateAutosaveEnabled);
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

  const notifySaveFailure = useCallback((error: unknown) => {
    if (!playbookFeatures.xstateAutosaveEnabled) return;

    const apiError = parseApiError(error);
    if (apiError.code === ErrorCode.CONFLICT) {
      autosaveActor.send({ type: 'CONFLICT_DETECTED', errorCode: apiError.code });
      return;
    }

    autosaveActor.send({ type: 'DELTA_SAVE_FAILED' });
  }, [autosaveActor]);

  const clearTimer = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
  }, []);

  const doSave = useCallback(() => {
    clearTimer();
    if (playbookFeatures.xstateAutosaveEnabled) {
      autosaveActor.send({ type: 'SAVE_NOW', reason: 'autosave' });
    }
    return Promise.resolve(saveCurrentPlaybook({ reason: 'autosave' })).then((result) => {
      if (playbookFeatures.xstateAutosaveEnabled) {
        autosaveActor.send({ type: 'DELTA_SAVE_SUCCEEDED', durationMs: lastAutosaveDurationMs });
      }
      return result;
    }).catch((error: unknown) => {
      notifySaveFailure(error);
      throw error;
    });
  }, [autosaveActor, clearTimer, lastAutosaveDurationMs, notifySaveFailure, saveCurrentPlaybook]);

  useEffect(() => {
    if (!isDirty || dirtyVersion === 0 || hasUnboundRequiredPorts || hasIncompleteBindings) return;

    const now = Date.now();
    const previousDirtyAt = lastDirtyAtRef.current;
    lastDirtyAtRef.current = now;
    if (playbookFeatures.xstateAutosaveEnabled) {
      autosaveActor.send({ type: 'LOCAL_CHANGE', dirtyVersion });
    }

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
    autosaveActor,
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
    if (playbookFeatures.xstateAutosaveEnabled) {
      autosaveActor.send({ type: 'SAVE_NOW', reason: 'manual' });
    }
    return Promise.resolve(saveCurrentPlaybook({ reason: 'manual' })).then((result) => {
      if (playbookFeatures.xstateAutosaveEnabled) {
        autosaveActor.send({ type: 'DELTA_SAVE_SUCCEEDED', durationMs: lastAutosaveDurationMs });
      }
      return result;
    }).catch((error: unknown) => {
      notifySaveFailure(error);
      throw error;
    });
  }, [
    autosaveActor,
    clearTimer,
    hasIncompleteBindings,
    hasUnboundRequiredPorts,
    lastAutosaveDurationMs,
    notifySaveFailure,
    saveCurrentPlaybook,
  ]);

  return { saveNow, isDirty, isSaving, hasUnboundRequiredPorts, hasIncompleteBindings };
}
