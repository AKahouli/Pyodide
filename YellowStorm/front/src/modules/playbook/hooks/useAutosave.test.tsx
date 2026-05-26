import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';
import type { DataBinding, PlaybookTask } from '../types';

const storeState = vi.hoisted(() => ({
  isDirty: false,
  isSaving: false,
  dirtyVersion: 0,
  saveCurrentPlaybook: vi.fn(),
  currentPlaybook: {
    tasks: [] as PlaybookTask[],
    dataBindings: [] as DataBinding[],
  },
}));

vi.mock('../store', () => ({
  useIsDirty: () => storeState.isDirty,
  useIsSaving: () => storeState.isSaving,
  useDirtyVersion: () => storeState.dirtyVersion,
  usePlaybookStore: (selector: (state: { saveCurrentPlaybook: () => void; currentPlaybook: typeof storeState.currentPlaybook }) => unknown) =>
    selector({ saveCurrentPlaybook: storeState.saveCurrentPlaybook, currentPlaybook: storeState.currentPlaybook }),
}));

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storeState.isDirty = false;
    storeState.isSaving = false;
    storeState.dirtyVersion = 0;
    storeState.currentPlaybook = { tasks: [], dataBindings: [] };
  });

  it('debounces save when dirty version changes', () => {
    const { rerender } = renderHook(() => useAutosave());
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;
    rerender();

    act(() => {
      vi.advanceTimersByTime(999);
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
