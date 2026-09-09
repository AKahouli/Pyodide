/**
 * Autosave Hook
 * Saves playbook canvas changes after adaptive inactivity windows.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { parseApiError } from '@/lib/api-error';
import { ErrorCode } from '@/lib/error-codes';
import { usePlaybookStore, useIsDirty, useIsSaving, useDirtyVersion } from '../store';
import { getPlaybookValidationIssues } from '../utils/required-port-validation';
import { playbookFeatures } from '../features';
import { useAutosaveActor } from '../machines/autosave/useAutosaveActor';

const IDLE_DEBOUNCE_MS = 600;
const ACTIVE_EDIT_DEBOUNCE_MS = 1500;
const MAX_DEBOUNCE_MS = 2500;

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

export function useAutosave(options?: { paused?: boolean }) {
  const paused = options?.paused === true;
  const isDirty = useIsDirty();
  const isSaving = useIsSaving();
  const dirtyVersion = useDirtyVersion();
  const autosaveActor = useAutosaveActor(playbookFeatures.xstateAutosaveEnabled);
  const saveCurrentPlaybook = usePlaybookStore((s) => s.saveCurrentPlaybook);
  const setPendingAutosaveAfterCurrent = usePlaybookStore((s) => s.setPendingAutosaveAfterCurrent);
  const lastAutosaveDurationMs = usePlaybookStore((s) => s.lastAutosaveDurationMs);
  const autosaveBackoffUntil = usePlaybookStore((s) => s.autosaveBackoffUntil);
  const currentPlaybook = usePlaybookStore((s) => s.currentPlaybook);
  const validationIssues = useMemo(
    () => currentPlaybook
      ? getPlaybookValidationIssues(currentPlaybook.tasks, currentPlaybook.dataBindings ?? [], currentPlaybook.controlEdges ?? [])
      : [],
    [currentPlaybook],
  );
  const hasUnboundRequiredPorts = validationIssues.some((issue) => issue.reason === 'missing_required_binding');
  const hasIncompleteBindings = validationIssues.some((issue) => issue.reason !== 'missing_required_binding');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDirtyAtRef = useRef<number | null>(null);
  const lastReportedDirtyVersionRef = useRef(0);
  const conflictDirtyVersionRef = useRef<number | null>(null);
  const currentDirtyVersionRef = useRef(dirtyVersion);
  currentDirtyVersionRef.current = dirtyVersion;

  const notifySaveFailure = useCallback((error: unknown, failedDirtyVersion: number) => {
    const apiError = parseApiError(error);
    if (apiError.code === ErrorCode.CONFLICT) {
      const latestDirtyVersion = currentDirtyVersionRef.current;
      conflictDirtyVersionRef.current = latestDirtyVersion === failedDirtyVersion
        ? failedDirtyVersion
        : null;
      if (playbookFeatures.xstateAutosaveEnabled) {
        autosaveActor.send({ type: 'CONFLICT_DETECTED', errorCode: apiError.code });
        if (latestDirtyVersion !== failedDirtyVersion) {
          autosaveActor.send({ type: 'LOCAL_CHANGE', dirtyVersion: latestDirtyVersion });
        }
      }
      return;
    }

    if (playbookFeatures.xstateAutosaveEnabled) {
      autosaveActor.send({ type: 'DELTA_SAVE_FAILED' });
    }
  }, [autosaveActor]);

  const clearTimer = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
  }, []);

  const doSave = useCallback(() => {
    const saveDirtyVersion = dirtyVersion;
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
      notifySaveFailure(error, saveDirtyVersion);
      // Timer-triggered saves report through the autosave actor; do not leave
      // an unhandled rejected promise behind when a conflict blocks retries.
    });
  }, [autosaveActor, clearTimer, dirtyVersion, lastAutosaveDurationMs, notifySaveFailure, saveCurrentPlaybook]);

  useEffect(() => {
    if (paused) {
      clearTimer();
      return;
    }
    if (!isDirty || dirtyVersion === 0) return;

    const now = Date.now();
    const previousDirtyAt = lastDirtyAtRef.current;
    const hasNewLocalChange = lastReportedDirtyVersionRef.current !== dirtyVersion;
    if (hasNewLocalChange) {
      lastReportedDirtyVersionRef.current = dirtyVersion;
      lastDirtyAtRef.current = now;
      if (conflictDirtyVersionRef.current !== dirtyVersion) {
        conflictDirtyVersionRef.current = null;
      }
    }
    if (playbookFeatures.xstateAutosaveEnabled && hasNewLocalChange) {
      autosaveActor.send({ type: 'LOCAL_CHANGE', dirtyVersion });
    }

    if (conflictDirtyVersionRef.current === dirtyVersion || autosaveActor.isBlockedByConflict) {
      clearTimer();
      return;
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
    isDirty,
    isSaving,
    lastAutosaveDurationMs,
    paused,
    setPendingAutosaveAfterCurrent,
  ]);

  // Cleanup on unmount
  useEffect(() => clearTimer, [clearTimer]);

  const saveNow = useCallback(() => {
    if (hasUnboundRequiredPorts || hasIncompleteBindings) return Promise.resolve();
    const saveDirtyVersion = dirtyVersion;
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
      notifySaveFailure(error, saveDirtyVersion);
      throw error;
    });
  }, [
    autosaveActor,
    clearTimer,
    dirtyVersion,
    hasIncompleteBindings,
    hasUnboundRequiredPorts,
    lastAutosaveDurationMs,
    notifySaveFailure,
    saveCurrentPlaybook,
  ]);

  return { saveNow, isDirty, isSaving, hasUnboundRequiredPorts, hasIncompleteBindings, validationIssues };
}
