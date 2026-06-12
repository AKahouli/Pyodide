import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';
import type { DataBinding, PlaybookTask } from '../types';

const storeState = vi.hoisted(() => ({
  isDirty: false,
  isSaving: false,
  dirtyVersion: 0,
  lastAutosaveDurationMs: null as number | null,
  autosaveBackoffUntil: null as number | null,
  saveCurrentPlaybook: vi.fn(),
  setPendingAutosaveAfterCurrent: vi.fn(),
  currentPlaybook: {
    tasks: [] as PlaybookTask[],
    dataBindings: [] as DataBinding[],
  },
}));

vi.mock('../store', () => ({
  useIsDirty: () => storeState.isDirty,
  useIsSaving: () => storeState.isSaving,
  useDirtyVersion: () => storeState.dirtyVersion,
  usePlaybookStore: (
    selector: (state: {
      saveCurrentPlaybook: () => void;
      setPendingAutosaveAfterCurrent: (pending: boolean) => void;
      lastAutosaveDurationMs: number | null;
      autosaveBackoffUntil: number | null;
      currentPlaybook: typeof storeState.currentPlaybook;
    }) => unknown,
  ) =>
    selector({
      saveCurrentPlaybook: storeState.saveCurrentPlaybook,
      setPendingAutosaveAfterCurrent: storeState.setPendingAutosaveAfterCurrent,
      lastAutosaveDurationMs: storeState.lastAutosaveDurationMs,
      autosaveBackoffUntil: storeState.autosaveBackoffUntil,
      currentPlaybook: storeState.currentPlaybook,
    }),
}));

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storeState.isDirty = false;
    storeState.isSaving = false;
    storeState.dirtyVersion = 0;
    storeState.lastAutosaveDurationMs = null;
    storeState.autosaveBackoffUntil = null;
    storeState.currentPlaybook = { tasks: [], dataBindings: [] };
  });

  it('debounces save when dirty version changes', () => {
    const { rerender } = renderHook(() => useAutosave());
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;
    rerender();

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
  });

  it('exposes saveNow that bypasses debounce', async () => {
    const { result } = renderHook(() => useAutosave());
    await act(async () => {
      await result.current.saveNow();
    });
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
  });

  it('extends debounce for continuous edits and save backoff', () => {
    const { rerender } = renderHook(() => useAutosave());
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;
    rerender();

    act(() => {
      vi.advanceTimersByTime(600);
    });

    storeState.dirtyVersion = 2;
    rerender();

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1801);
    });
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
  });

  it('marks a trailing autosave when edits happen during an in-flight save', () => {
    const { rerender } = renderHook(() => useAutosave());
    storeState.isDirty = true;
    storeState.isSaving = true;
    storeState.dirtyVersion = 1;

    rerender();

    expect(storeState.setPendingAutosaveAfterCurrent).toHaveBeenCalledWith(true);
    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();
  });

  it('does not save while bindings are incomplete', async () => {
    storeState.currentPlaybook = {
      tasks: [],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
      }],
    };

    const { result } = renderHook(() => useAutosave());
    await act(async () => {
      await result.current.saveNow();
    });

    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();
    expect(result.current.hasIncompleteBindings).toBe(true);
  });
});
