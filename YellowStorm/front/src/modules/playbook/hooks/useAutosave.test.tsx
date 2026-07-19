import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';
import type { DataBinding, PlaybookTask } from '../types';

const actorSendMock = vi.hoisted(() => vi.fn());
const parseApiErrorMock = vi.hoisted(() => vi.fn(() => ({ code: 'ERR_0000' })));
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

vi.mock('../features', () => ({
  playbookFeatures: {
    xstateAutosaveEnabled: true,
  },
}));

vi.mock('../machines/autosave/useAutosaveActor', () => ({
  useAutosaveActor: () => ({
    status: 'clean',
    canSaveNow: true,
    isSaving: false,
    isBlockedByConflict: false,
    send: actorSendMock,
  }),
}));

vi.mock('@/lib/api-error', () => ({
  parseApiError: parseApiErrorMock,
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
    parseApiErrorMock.mockReturnValue({ code: 'ERR_0000' });
  });

  it('debounces save when dirty version changes', () => {
    const { rerender } = renderHook(() => useAutosave());
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;
    rerender();

    act(() => {
      vi.advanceTimersByTime(599);
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
      vi.advanceTimersByTime(599);
    });

    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);

    storeState.saveCurrentPlaybook.mockClear();

    storeState.dirtyVersion = 2;
    rerender();

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
  });

  it('does not autosave streamed changes while paused and resumes afterwards', () => {
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;
    const { rerender } = renderHook(
      ({ paused }) => useAutosave({ paused }),
      { initialProps: { paused: true } },
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();

    rerender({ paused: false });
    act(() => {
      vi.advanceTimersByTime(600);
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
    expect(result.current.validationIssues).toEqual([expect.objectContaining({
      taskId: 'target-1',
      portId: 'prompt',
      reason: 'missing_node_output',
    })]);
  });

  it('still autosaves while bindings are incomplete', () => {
    storeState.currentPlaybook = {
      tasks: [],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
      }],
    };

    const { result, rerender } = renderHook(() => useAutosave());
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;
    rerender();

    act(() => {
      vi.advanceTimersByTime(599);
    });

    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledWith({ reason: 'autosave' });
    expect(result.current.hasIncompleteBindings).toBe(true);
  });

  it('still autosaves while required ports are unbound', () => {
    storeState.currentPlaybook = {
      tasks: [{
        id: 'task-1',
        type: 'agent',
        name: 'Task 1',
        position: { x: 0, y: 0 },
        inputPorts: [{ id: 'prompt', name: 'Prompt', type: 'string', required: true }],
      } as unknown as PlaybookTask],
      dataBindings: [],
    };

    const { result, rerender } = renderHook(() => useAutosave());
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;
    rerender();

    act(() => {
      vi.advanceTimersByTime(599);
    });

    expect(storeState.saveCurrentPlaybook).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledWith({ reason: 'autosave' });
    expect(result.current.hasUnboundRequiredPorts).toBe(true);
    expect(result.current.validationIssues).toEqual([expect.objectContaining({
      taskId: 'task-1',
      portId: 'prompt',
      reason: 'missing_required_binding',
    })]);
  });

  it('reports autosave conflicts to the autosave actor', async () => {
    const conflictError = new Error('conflict');
    storeState.saveCurrentPlaybook.mockRejectedValueOnce(conflictError);
    parseApiErrorMock.mockReturnValue({ code: 'ERR_1005' });

    const { result } = renderHook(() => useAutosave());

    await expect(result.current.saveNow()).rejects.toThrow('conflict');

    expect(actorSendMock).toHaveBeenCalledWith({ type: 'SAVE_NOW', reason: 'manual' });
    expect(actorSendMock).toHaveBeenCalledWith({ type: 'CONFLICT_DETECTED', errorCode: 'ERR_1005' });
  });

  it('reports non-conflict autosave failures as generic delta failures', async () => {
    const saveError = new Error('save failed');
    storeState.saveCurrentPlaybook.mockRejectedValueOnce(saveError);
    parseApiErrorMock.mockReturnValue({ code: 'ERR_1000' });

    const { result } = renderHook(() => useAutosave());

    await expect(result.current.saveNow()).rejects.toThrow('save failed');

    expect(actorSendMock).toHaveBeenCalledWith({ type: 'SAVE_NOW', reason: 'manual' });
    expect(actorSendMock).toHaveBeenCalledWith({ type: 'DELTA_SAVE_FAILED' });
  });
});
