import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

const storeState = vi.hoisted(() => ({
  isDirty: false,
  isSaving: false,
  dirtyVersion: 0,
  saveCurrentPlaybook: vi.fn(),
}));

vi.mock('../store', () => ({
  useIsDirty: () => storeState.isDirty,
  useIsSaving: () => storeState.isSaving,
  useDirtyVersion: () => storeState.dirtyVersion,
  usePlaybookStore: (selector: (state: { saveCurrentPlaybook: () => void }) => unknown) =>
    selector({ saveCurrentPlaybook: storeState.saveCurrentPlaybook }),
}));

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storeState.isDirty = false;
    storeState.isSaving = false;
    storeState.dirtyVersion = 0;
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

  it('exposes saveNow that bypasses debounce', () => {
    const { result } = renderHook(() => useAutosave());
    act(() => result.current.saveNow());
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
  });
});
