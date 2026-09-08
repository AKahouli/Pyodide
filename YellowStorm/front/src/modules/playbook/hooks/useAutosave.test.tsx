import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';
import type { ControlEdge, DataBinding, PlaybookTask } from '../types';

const actorSendMock = vi.hoisted(() => vi.fn());
const actorState = vi.hoisted(() => ({ isBlockedByConflict: false }));
const featureState = vi.hoisted(() => ({ xstateAutosaveEnabled: true }));
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
    controlEdges: [] as ControlEdge[],
  } as { tasks: PlaybookTask[]; dataBindings: DataBinding[]; controlEdges?: ControlEdge[] },
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
    get xstateAutosaveEnabled() {
      return featureState.xstateAutosaveEnabled;
    },
  },
}));

vi.mock('../machines/autosave/useAutosaveActor', () => ({
  useAutosaveActor: () => ({
    status: 'clean',
    canSaveNow: true,
    isSaving: false,
    isBlockedByConflict: actorState.isBlockedByConflict,
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
    actorState.isBlockedByConflict = false;
    featureState.xstateAutosaveEnabled = true;
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

  it('does not block manual save when a router edge targets the required port', async () => {
    storeState.currentPlaybook = {
      tasks: [
        { id: 'router-1', nodeType: 'router', inputPorts: [], outputPorts: [] } as unknown as PlaybookTask,
        {
          id: 'task-1',
          type: 'agent',
          name: 'Task 1',
          position: { x: 0, y: 0 },
          inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }],
        } as unknown as PlaybookTask,
      ],
      dataBindings: [],
      controlEdges: [{
        id: 'edge-1',
        kind: 'conditional',
        source: 'router-1',
        target: 'task-1',
        routerLabel: 'continue',
        targetInputPortId: 'prompt',
      }],
    };

    const { result } = renderHook(() => useAutosave());
    await act(async () => {
      await result.current.saveNow();
    });

    expect(result.current.validationIssues).toEqual([]);
    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledWith({ reason: 'manual' });
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

  it('does not retry a timer-triggered conflict until another local edit', async () => {
    const conflictError = new Error('conflict');
    storeState.saveCurrentPlaybook.mockRejectedValue(conflictError);
    parseApiErrorMock.mockReturnValue({ code: 'ERR_1005' });
    actorSendMock.mockImplementation((event: { type: string }) => {
      if (event.type === 'CONFLICT_DETECTED') actorState.isBlockedByConflict = true;
      if (event.type === 'LOCAL_CHANGE') actorState.isBlockedByConflict = false;
    });
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;

    const { rerender } = renderHook(() => useAutosave());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
    expect(actorSendMock).toHaveBeenCalledWith({ type: 'CONFLICT_DETECTED', errorCode: 'ERR_1005' });
  });

  it('does not retry a timer-triggered conflict when the autosave actor is disabled', async () => {
    featureState.xstateAutosaveEnabled = false;
    storeState.saveCurrentPlaybook.mockRejectedValue(new Error('conflict'));
    parseApiErrorMock.mockReturnValue({ code: 'ERR_1005' });
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;

    const { rerender } = renderHook(() => useAutosave());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(1);
    expect(actorSendMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'CONFLICT_DETECTED' }));
  });

  it('retries a newer edit when an older in-flight save conflicts', async () => {
    let rejectFirstSave: ((error: Error) => void) | undefined;
    storeState.saveCurrentPlaybook
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirstSave = reject; }))
      .mockResolvedValueOnce(undefined);
    parseApiErrorMock.mockReturnValue({ code: 'ERR_1005' });
    actorSendMock.mockImplementation((event: { type: string }) => {
      if (event.type === 'CONFLICT_DETECTED') actorState.isBlockedByConflict = true;
      if (event.type === 'LOCAL_CHANGE') actorState.isBlockedByConflict = false;
    });
    storeState.isDirty = true;
    storeState.dirtyVersion = 1;

    const { rerender } = renderHook(() => useAutosave());
    act(() => {
      vi.advanceTimersByTime(600);
    });
    storeState.isSaving = true;
    storeState.dirtyVersion = 2;
    rerender();
    await act(async () => {
      rejectFirstSave?.(new Error('conflict'));
      await Promise.resolve();
    });
    storeState.isSaving = false;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(storeState.saveCurrentPlaybook).toHaveBeenCalledTimes(2);
    expect(actorSendMock).toHaveBeenCalledWith({ type: 'LOCAL_CHANGE', dirtyVersion: 2 });
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
