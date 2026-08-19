import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as autoLayoutModule from '../utils/auto-layout';
import { tasksToNodes } from '../hooks/helpers/node-serializer';
import { makePlaybook, makeTask } from '../test-utils';
import type { Playbook, PlaybookDefinitionExport } from '../types';
import { usePlaybookCanvasPageHandlers } from './usePlaybookCanvasPageHandlers';

vi.mock('../utils/playbookImport', () => ({
  readPlaybookDefinitionFile: vi.fn(),
  PlaybookImportError: class PlaybookImportError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'PlaybookImportError';
    }
  },
}));

const openPanelMock = vi.hoisted(() => vi.fn());
vi.mock('../../second-brain/secondBrainPanelStore', () => ({
  useSecondBrainPanelStore: {
    getState: () => ({ openPanel: openPanelMock }),
  },
}));

import { readPlaybookDefinitionFile } from '../utils/playbookImport';

describe('usePlaybookCanvasPageHandlers', () => {
  const setEditingName = vi.fn();
  const setNodeReflectionEnabled = vi.fn();
  const setAdvisorScoringMode = vi.fn();
  const setAdvisorAutopilotEnabled = vi.fn();
  const fitCanvasToNodes = vi.fn();
  const setNodes = vi.fn();
  const setEdges = vi.fn();
  const setPendingImport = vi.fn();
  const setImportWarningOpen = vi.fn();
  const setExecutionPanelOpen = vi.fn();
  const setExecutionPanelCollapsed = vi.fn();
  const setDesignerOpen = vi.fn();
  const setEditorOpen = vi.fn();
  const setPageMode = vi.fn();
  const setCopilotMode = vi.fn();

  const exportPlaybookDefinition = vi.fn();
  const importPlaybookDefinition = vi.fn();
  const updateTasks = vi.fn();
  const updateEdges = vi.fn();
  const updateDataBindings = vi.fn();
  const updatePlaybook = vi.fn().mockResolvedValue(undefined);
  const updateWorkspaces = vi.fn();
  const captureSnapshot = vi.fn();
  const showError = vi.fn();

  const readPlaybookDefinitionFileMock = vi.mocked(readPlaybookDefinitionFile);

  const importFileInputRef = {
    current: {
      files: [],
      value: 'pre-filled',
    } as unknown as HTMLInputElement,
  };

  const makeInputWithFile = (file: File) => ({
    current: {
      files: [file],
      value: 'pre-filled',
    } as unknown as HTMLInputElement,
  });

  const buildHandler = ({
    nameValue = 'Playbook title',
    id = 'playbook-1',
    playbook = makePlaybook(),
    pageMode = 'design',
    designerOpen = false,
    waitingForHumanInput = false,
    nodeReflectionEnabled = true,
    advisorScoringMode = 'llm',
    advisorAutopilotEnabled = false,
    pendingImport = null,
    fileInputRef = importFileInputRef,
  }: {
    nameValue?: string;
    id?: string;
    playbook?: Playbook | null;
    pageMode?: 'design' | 'run';
    designerOpen?: boolean;
    waitingForHumanInput?: boolean;
    nodeReflectionEnabled?: boolean;
    advisorScoringMode?: 'heuristic' | 'llm';
    advisorAutopilotEnabled?: boolean;
    pendingImport?: PlaybookDefinitionExport | null;
    fileInputRef?: { current: HTMLInputElement | null };
  } = {}) => {
    const { result } = renderHook(() =>
      usePlaybookCanvasPageHandlers({
        id,
        playbook,
        nameValue,
        nodeReflectionEnabled,
        advisorScoringMode,
        advisorAutopilotEnabled,
        pageMode,
        designerOpen,
        waitingForHumanInput,
        confirmRemoveAllMessage: 'Remove all tasks?',
        workspaceRequiredError: 'At least one workspace is required',
        importReadErrorMessage: 'Cannot read import file',
        pendingImport,
        setEditingName,
        setNodeReflectionEnabled,
        setAdvisorScoringMode,
        setAdvisorAutopilotEnabled,
        fitCanvasToNodes,
        setNodes,
        setEdges,
        setPendingImport,
        setImportWarningOpen,
        setExecutionPanelOpen,
        setExecutionPanelCollapsed,
        setDesignerOpen,
        setEditorOpen,
        setPageMode,
        setCopilotMode,
        importFileInputRef: fileInputRef,
        updatePlaybook,
        exportPlaybookDefinition,
        importPlaybookDefinition,
        updateTasks,
        updateEdges,
        updateDataBindings,
        captureSnapshot,
        showError,
        updateWorkspaces,
      }),
    );

    return { result };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setEditingName.mockClear();
    setNodeReflectionEnabled.mockClear();
    setAdvisorScoringMode.mockClear();
    setAdvisorAutopilotEnabled.mockClear();
    fitCanvasToNodes.mockClear();
    setNodes.mockClear();
    setEdges.mockClear();
    setPendingImport.mockClear();
    setImportWarningOpen.mockClear();
    setExecutionPanelOpen.mockClear();
    setExecutionPanelCollapsed.mockClear();
    setDesignerOpen.mockClear();
    setEditorOpen.mockClear();
    setPageMode.mockClear();
    setCopilotMode.mockClear();
    exportPlaybookDefinition.mockClear();
    importPlaybookDefinition.mockClear();
    updateTasks.mockClear();
    updateEdges.mockClear();
    updateDataBindings.mockClear();
    updatePlaybook.mockClear();
    updateWorkspaces.mockClear();
    captureSnapshot.mockClear();
    showError.mockClear();
    updatePlaybook.mockResolvedValue(undefined);
    readPlaybookDefinitionFileMock.mockReset();
  });

  it('updates reflection and sends the same advisor fields', async () => {
    const playbook = makePlaybook({
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 89,
      advisorAutopilotMaxTurns: 4,
    });

    const { result } = buildHandler({
      pageMode: 'design',
      nodeReflectionEnabled: false,
      playbook,
      advisorScoringMode: 'llm',
      advisorAutopilotEnabled: true,
    });

    await act(async () => {
      await result.current.handleNodeReflectionChange(true);
    });

    expect(setNodeReflectionEnabled).toHaveBeenCalledWith(true);
    expect(updatePlaybook).toHaveBeenCalledWith('playbook-1', {
      reflectionEnabled: true,
      advisorScoringMode: 'llm',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 89,
      advisorAutopilotMaxTurns: 4,
    });
  });

  it('rolls back reflection state when save fails', async () => {
    updatePlaybook.mockRejectedValue(new Error('save failed'));
    const { result } = buildHandler({
      nodeReflectionEnabled: false,
      playbook: makePlaybook(),
      advisorScoringMode: 'llm',
      advisorAutopilotEnabled: false,
    });

    await act(async () => {
      await result.current.handleNodeReflectionChange(true);
    });

    expect(setNodeReflectionEnabled).toHaveBeenLastCalledWith(false);
  });

  it('does not update autopilot fields when no playbook exists', async () => {
    const { result } = buildHandler({ playbook: null as null, nodeReflectionEnabled: false, advisorScoringMode: 'llm' });

    await act(async () => {
      await result.current.handleAdvisorScoringModeChange('heuristic');
    });

    expect(updatePlaybook).not.toHaveBeenCalled();
  });

  it('layouts all nodes from the current playbook definition', () => {
    const playbook = makePlaybook();
    const layoutedTasks = [
      makeTask({ id: 'layouted', title: 'Layouted task', executionOrder: 1, positionX: 1, positionY: 2 }),
    ];
    const autoLayoutSpy = vi.spyOn(autoLayoutModule, 'autoLayoutTasks').mockReturnValue(layoutedTasks);

    const { result } = buildHandler({ playbook });

    act(() => {
      result.current.handleAutoLayout();
    });

    expect(captureSnapshot).toHaveBeenCalled();
    expect(autoLayoutSpy).toHaveBeenCalledWith(playbook.tasks, playbook.edges);
    expect(setNodes).toHaveBeenCalledWith(tasksToNodes(layoutedTasks));
    expect(updateTasks).toHaveBeenCalledWith(layoutedTasks);
    expect(fitCanvasToNodes).toHaveBeenCalledOnce();

    autoLayoutSpy.mockRestore();
  });

  it('does nothing for layout when playbook is missing', () => {
    const { result } = buildHandler({ playbook: null as null });

    act(() => {
      result.current.handleAutoLayout();
    });

    expect(captureSnapshot).not.toHaveBeenCalled();
  });

  it('exports the playbook definition', () => {
    const playbook = makePlaybook({ id: 'export-id', name: 'Export me' });
    const { result } = buildHandler({ id: 'export-id', playbook });

    act(() => {
      result.current.handleExportPlaybook();
    });

    expect(exportPlaybookDefinition).toHaveBeenCalledWith(playbook);
  });

  it('opens import warning state after reading definition file', async () => {
    const playbookDefinition: PlaybookDefinitionExport = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      name: 'Imported playbook',
      description: '',
      tasks: [],
      edges: [],
    };
    readPlaybookDefinitionFileMock.mockResolvedValue(playbookDefinition);

    const inputFile = new File(['{"name":"x"}'], 'import.json', { type: 'application/json' });
    const { result } = buildHandler({ fileInputRef: makeInputWithFile(inputFile) });

    await act(async () => {
      await result.current.handleImportFileSelect();
    });

    expect(readPlaybookDefinitionFileMock).toHaveBeenCalledWith(inputFile);
    expect(setPendingImport).toHaveBeenCalledWith(playbookDefinition);
    expect(setImportWarningOpen).toHaveBeenCalledWith(true);
    expect(showError).not.toHaveBeenCalled();
  });

  it('shows fallback import error when file read fails', async () => {
    readPlaybookDefinitionFileMock.mockRejectedValue(new Error('bad json'));
    const inputFile = new File(['bad'], 'import.json', { type: 'application/json' });

    const { result } = buildHandler({ fileInputRef: makeInputWithFile(inputFile) });

    await act(async () => {
      await result.current.handleImportFileSelect();
    });

    expect(showError).toHaveBeenCalledWith('Cannot read import file');
    expect(setPendingImport).not.toHaveBeenCalled();
  });

  it('confirms import only when pending definition exists', () => {
    const definition: PlaybookDefinitionExport = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      name: 'Imported',
      description: '',
      tasks: [],
      edges: [],
    };

    const { result } = buildHandler({ pendingImport: definition });

    act(() => {
      result.current.handleImportConfirm();
    });

    expect(importPlaybookDefinition).toHaveBeenCalledWith(definition);
    expect(setPendingImport).toHaveBeenCalledWith(null);
    expect(setImportWarningOpen).toHaveBeenCalledWith(false);
  });

  it('clears import state on cancel', () => {
    const { result } = buildHandler({ pendingImport: null });

    act(() => {
      result.current.handleImportCancel();
    });

    expect(setPendingImport).toHaveBeenCalledWith(null);
    expect(setImportWarningOpen).toHaveBeenCalledWith(false);
  });

  it('removes all tasks only after confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const { result } = buildHandler({ playbook: makePlaybook({ tasks: [makeTask({ id: 'task-1' })] }) });

    act(() => {
      result.current.handleRemoveAllTasks();
    });

    expect(confirmSpy).toHaveBeenCalledWith('Remove all tasks?');
    expect(updateTasks).toHaveBeenCalledWith([]);
    expect(updateEdges).toHaveBeenCalledWith([]);
    expect(updateDataBindings).toHaveBeenCalledWith([]);

    confirmSpy.mockRestore();
  });

  it('does not clear tasks when confirmation is canceled', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const { result } = buildHandler({ playbook: makePlaybook({ tasks: [makeTask({ id: 'task-1' })] }) });

    act(() => {
      result.current.handleRemoveAllTasks();
    });

    expect(confirmSpy).toHaveBeenCalledWith('Remove all tasks?');
    expect(updateTasks).not.toHaveBeenCalled();
    expect(updateEdges).not.toHaveBeenCalled();
    expect(updateDataBindings).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('opens the global Yellowmind assistant from the toolbar instead of the local designer', () => {
    openPanelMock.mockClear();
    const { result } = buildHandler({ pageMode: 'run', designerOpen: false });

    act(() => {
      result.current.handleToggleCopilot();
    });

    expect(openPanelMock).toHaveBeenCalledTimes(1);
    expect(setCopilotMode).not.toHaveBeenCalled();
    expect(setDesignerOpen).not.toHaveBeenCalled();
    expect(setEditorOpen).not.toHaveBeenCalled();
  });

  it('opens the native HITL decision panel when an interrupt is pending', () => {
    openPanelMock.mockClear();
    const { result } = buildHandler({ designerOpen: false, waitingForHumanInput: true });

    act(() => {
      result.current.handleToggleCopilot();
    });

    expect(openPanelMock).not.toHaveBeenCalled();
    expect(setCopilotMode).toHaveBeenCalledWith('interrupt');
    expect(setDesignerOpen).toHaveBeenCalledWith(true);
  });

  it('switches run mode and closes the execution panel', () => {
    const { result } = buildHandler({ pageMode: 'design', designerOpen: true });

    act(() => {
      result.current.handlePageModeChange('run');
    });

    expect(setPageMode).toHaveBeenCalledWith('run');
    expect(setExecutionPanelCollapsed).toHaveBeenCalledWith(false);
    expect(setExecutionPanelOpen).toHaveBeenCalledWith(true);
    expect(setDesignerOpen).not.toHaveBeenCalled();
  });

  it('switching to design mode no longer opens the local designer panel', () => {
    const { result } = buildHandler({ designerOpen: true });

    act(() => {
      result.current.handlePageModeChange('design');
    });

    expect(setExecutionPanelCollapsed).toHaveBeenCalledWith(true);
    expect(setExecutionPanelOpen).toHaveBeenCalledWith(false);
    expect(setCopilotMode).not.toHaveBeenCalled();
    expect(setDesignerOpen).not.toHaveBeenCalled();
  });

  it('saves the new playbook name when blurred with changes', () => {
    const playbook = makePlaybook({ name: 'Old name' });
    const { result } = buildHandler({ id: 'playbook-1', playbook, nameValue: '  New name  ' });

    act(() => {
      result.current.handleNameBlur();
    });

    expect(setEditingName).toHaveBeenCalledWith(false);
    expect(captureSnapshot).toHaveBeenCalled();
    expect(updatePlaybook).toHaveBeenCalledWith('playbook-1', { name: 'New name' });
  });

  it('requires at least one workspace and updates playbook workspaces otherwise', () => {
    const playbook = makePlaybook();
    const { result } = buildHandler({ id: 'playbook-1', playbook });

    act(() => {
      result.current.handleWorkspacesChange([]);
    });

    expect(showError).toHaveBeenCalledWith('At least one workspace is required');
    expect(updateWorkspaces).not.toHaveBeenCalled();

    act(() => {
      result.current.handleWorkspacesChange(['ws-1']);
    });

    expect(captureSnapshot).toHaveBeenCalled();
    expect(updateWorkspaces).toHaveBeenCalledWith(['ws-1']);
    expect(updatePlaybook).toHaveBeenCalledWith('playbook-1', { workspaces: ['ws-1'] });
  });
});
