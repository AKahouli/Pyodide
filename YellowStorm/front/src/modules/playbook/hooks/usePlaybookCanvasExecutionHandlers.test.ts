import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeExecution, makePlaybook, makeTask } from '../test-utils';
import { usePlaybookCanvasExecutionHandlers } from './usePlaybookCanvasExecutionHandlers';

describe('usePlaybookCanvasExecutionHandlers', () => {
  const showError = vi.fn();
  const saveNow = vi.fn().mockResolvedValue(undefined);
  const setPageMode = vi.fn();
  const setExecutionPanelCollapsed = vi.fn();
  const setDesignerOpen = vi.fn();
  const setWorkspaceExplorerOpen = vi.fn();
  const setConnectorSidebarOpen = vi.fn();
  const setSkillSidebarOpen = vi.fn();
  const setGlobalSidebarOpen = vi.fn();
  const executePlaybook = vi.fn().mockResolvedValue('execution-id');
  const stopExecution = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    saveNow.mockResolvedValue(undefined);
    executePlaybook.mockResolvedValue('execution-id');
    stopExecution.mockResolvedValue(undefined);
  });

  it('requires at least one workspace before running', async () => {
    const playbook = makePlaybook({
      id: 'playbook-1',
      workspaces: [],
      tasks: [makeTask()],
    });

    const { result } = renderHook(() =>
      usePlaybookCanvasExecutionHandlers({
        id: 'playbook-1',
        playbook,
        isDirty: false,
        saveNow,
        nodeReflectionEnabled: false,
        executePlaybook,
        stopExecution,
        currentExecution: null,
        execution: null,
        setPageMode,
        setExecutionPanelCollapsed,
        setDesignerOpen,
        setWorkspaceExplorerOpen,
        setConnectorSidebarOpen,
        setSkillSidebarOpen,
        setGlobalSidebarOpen,
        showError,
        workspaceRequiredForRunError: 'Please add a workspace',
      }),
    );

    await act(async () => {
      await result.current.handleRun();
    });

    expect(showError).toHaveBeenCalledWith('Please add a workspace');
    expect(executePlaybook).not.toHaveBeenCalled();
  });

  it('saves when dirty and sends the run payload', async () => {
    const playbook = makePlaybook({
      id: 'playbook-1',
      workspaces: ['ws-1'],
      tasks: [
        makeTask({ id: 'task-1', stepReplayMode: 'replay_strict' }),
        makeTask({ id: 'task-2', enabled: false }),
        makeTask({ id: 'task-3' }),
      ],
      advisorAutopilotEnabled: true,
      advisorScoringMode: 'heuristic',
      advisorAutopilotTargetScore: 81,
      advisorAutopilotMaxTurns: 5,
    });

    const { result } = renderHook(() =>
      usePlaybookCanvasExecutionHandlers({
        id: 'playbook-1',
        playbook,
        isDirty: true,
        saveNow,
        nodeReflectionEnabled: true,
        executePlaybook,
        stopExecution,
        currentExecution: null,
        execution: null,
        setPageMode,
        setExecutionPanelCollapsed,
        setDesignerOpen,
        setWorkspaceExplorerOpen,
        setConnectorSidebarOpen,
        setSkillSidebarOpen,
        setGlobalSidebarOpen,
        showError,
        workspaceRequiredForRunError: 'Please add a workspace',
      }),
    );

    await act(async () => {
      await result.current.handleRun();
    });

    expect(saveNow).toHaveBeenCalledOnce();
    expect(setPageMode).toHaveBeenCalledWith('run');
    expect(setExecutionPanelCollapsed).toHaveBeenCalledWith(false);
    expect(setDesignerOpen).toHaveBeenCalledWith(false);
    expect(setWorkspaceExplorerOpen).toHaveBeenCalledWith(false);
    expect(setConnectorSidebarOpen).toHaveBeenCalledWith(false);
    expect(setSkillSidebarOpen).toHaveBeenCalledWith(false);
    expect(setGlobalSidebarOpen).toHaveBeenCalledWith(false);
    expect(executePlaybook).toHaveBeenCalledWith('playbook-1', {
      executionMode: 'inherit',
      stepExecutionModes: {
        'task-1': 'replay_strict',
        'task-3': 'live',
      },
      streaming: true,
      runNodeReflection: true,
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 81,
      advisorAutopilotMaxTurns: 5,
    });
  });

  it('stops the active execution when it matches the current playbook', async () => {
    const playbook = makePlaybook({ id: 'playbook-1', workspaces: ['ws-1'] });
    const currentExecution = makeExecution({
      id: 'exec-current',
      playbookId: 'playbook-1',
    });
    const otherExecution = makeExecution({
      id: 'exec-other',
      playbookId: 'playbook-1',
    });

    const { result } = renderHook(() =>
      usePlaybookCanvasExecutionHandlers({
        id: 'playbook-1',
        playbook,
        isDirty: false,
        saveNow,
        nodeReflectionEnabled: false,
        executePlaybook,
        stopExecution,
        currentExecution,
        execution: otherExecution,
        setPageMode,
        setExecutionPanelCollapsed,
        setDesignerOpen,
        setWorkspaceExplorerOpen,
        setConnectorSidebarOpen,
        setSkillSidebarOpen,
        setGlobalSidebarOpen,
        showError,
        workspaceRequiredForRunError: 'Please add a workspace',
      }),
    );

    await act(async () => {
      await result.current.handleStop();
    });

    expect(stopExecution).toHaveBeenCalledWith('playbook-1', 'exec-current');
  });

  it('stops the secondary execution when current execution belongs elsewhere', async () => {
    const playbook = makePlaybook({ id: 'playbook-1', workspaces: ['ws-1'] });
    const otherExecution = makeExecution({ id: 'exec-other', playbookId: 'playbook-2' });
    const fallbackExecution = makeExecution({ id: 'exec-fallback', playbookId: 'playbook-1' });

    const { result } = renderHook(() =>
      usePlaybookCanvasExecutionHandlers({
        id: 'playbook-1',
        playbook,
        isDirty: false,
        saveNow,
        nodeReflectionEnabled: false,
        executePlaybook,
        stopExecution,
        currentExecution: otherExecution,
        execution: fallbackExecution,
        setPageMode,
        setExecutionPanelCollapsed,
        setDesignerOpen,
        setWorkspaceExplorerOpen,
        setConnectorSidebarOpen,
        setSkillSidebarOpen,
        setGlobalSidebarOpen,
        showError,
        workspaceRequiredForRunError: 'Please add a workspace',
      }),
    );

    await act(async () => {
      await result.current.handleStop();
    });

    expect(stopExecution).toHaveBeenCalledWith('playbook-1', 'exec-fallback');
  });
});
