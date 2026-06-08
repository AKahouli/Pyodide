import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeExecution } from '../test-utils';
import type { OutputFormatTemplate } from '../types';
import { usePlaybookCanvasOutputFormatHandlers } from './usePlaybookCanvasOutputFormatHandlers';

describe('usePlaybookCanvasOutputFormatHandlers', () => {
  const setEditingOutputFormatTaskId = vi.fn();
  const setEditingOutputFormatVersion = vi.fn();
  const setOutputFormatDraft = vi.fn();
  const setOutputFormatLoading = vi.fn();
  const setOutputFormatSaving = vi.fn();
  const setOutputFormatGenerating = vi.fn();

  const updateOutputFormatTemplate = vi.fn();
  const deleteOutputFormatTemplate = vi.fn();
  const grabOutputFormatTemplate = vi.fn();
  const fetchOutputFormatTemplate = vi.fn();
  const validateTaskReplay = vi.fn();
  const onBaselineSaved = vi.fn();

  const getTaskResultForNode = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setEditingOutputFormatTaskId.mockClear();
    setEditingOutputFormatVersion.mockClear();
    setOutputFormatDraft.mockClear();
    setOutputFormatLoading.mockClear();
    setOutputFormatSaving.mockClear();
    setOutputFormatGenerating.mockClear();

    updateOutputFormatTemplate.mockResolvedValue({
      formatGuide: 'saved',
      templateVersion: 4,
    } as unknown as OutputFormatTemplate);
    deleteOutputFormatTemplate.mockResolvedValue({ removed: true });
    fetchOutputFormatTemplate.mockResolvedValue(null);
    grabOutputFormatTemplate.mockResolvedValue({
      formatGuide: 'ready',
      templateVersion: 7,
      generationStatus: 'ready',
    } as unknown as OutputFormatTemplate);
    validateTaskReplay.mockResolvedValue(undefined);
  });

  const buildHandler = (id = 'playbook-1', editingTask: string | null = 'task-1', executionForNodeActions = makeExecution()) => {
    return renderHook(() =>
      usePlaybookCanvasOutputFormatHandlers({
        id,
        editingOutputFormatTaskId: editingTask,
        setEditingOutputFormatTaskId,
        setEditingOutputFormatVersion,
        setOutputFormatDraft,
        setOutputFormatLoading,
        setOutputFormatSaving,
        setOutputFormatGenerating,
        fetchOutputFormatTemplate,
        updateOutputFormatTemplate,
        deleteOutputFormatTemplate,
        grabOutputFormatTemplate,
        outputFormatDraft: 'Draft text',
        executionForNodeActions,
        getTaskResultForNode,
        onBaselineSaved,
        validateTaskReplay,
      }),
    );
  };

  it('loads template and loading state when opening the editor', async () => {
    fetchOutputFormatTemplate.mockResolvedValue({
      formatGuide: 'Template text',
      templateVersion: 12,
      generationStatus: 'ready',
    } as unknown as OutputFormatTemplate);

    const { result } = buildHandler();

    await act(async () => {
      await result.current.openOutputFormatEditor('task-1');
    });

    expect(setEditingOutputFormatTaskId).toHaveBeenCalledWith('task-1');
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(null);
    expect(setOutputFormatDraft).toHaveBeenCalledWith('');
    expect(setOutputFormatLoading).toHaveBeenCalledWith(true);
    expect(fetchOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1');
    expect(setOutputFormatDraft).toHaveBeenCalledWith('Template text');
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(12);
    expect(setOutputFormatLoading).toHaveBeenCalledWith(false);
  });

  it('clears all output-format editor state when closing', () => {
    const { result } = buildHandler();

    act(() => {
      result.current.closeOutputFormatDialog(false);
    });

    expect(setEditingOutputFormatTaskId).toHaveBeenCalledWith(null);
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(null);
    expect(setOutputFormatDraft).toHaveBeenCalledWith('');
    expect(setOutputFormatLoading).toHaveBeenCalledWith(false);
    expect(setOutputFormatSaving).toHaveBeenCalledWith(false);
    expect(setOutputFormatGenerating).toHaveBeenCalledWith(false);
  });

  it('ignores close when dialog is opening', () => {
    const { result } = buildHandler();

    act(() => {
      result.current.closeOutputFormatDialog(true);
    });

    expect(setEditingOutputFormatTaskId).not.toHaveBeenCalled();
    expect(setEditingOutputFormatVersion).not.toHaveBeenCalled();
  });

  it('saves template and closes task editing state', async () => {
    const { result } = buildHandler('playbook-1', 'task-1');

    await act(async () => {
      await result.current.handleSaveOutputFormat();
    });

    expect(setOutputFormatSaving).toHaveBeenCalledWith(true);
    expect(updateOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1', {
      formatGuide: 'Draft text',
    });
    expect(setOutputFormatDraft).toHaveBeenCalledWith('saved');
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(4);
    expect(setEditingOutputFormatTaskId).toHaveBeenCalledWith(null);
    expect(setOutputFormatSaving).toHaveBeenCalledWith(false);
  });

  it('deletes template and resets output-format editor state', async () => {
    const { result } = buildHandler('playbook-1', 'task-1');

    await act(async () => {
      await result.current.handleRemoveOutputFormat();
    });

    expect(deleteOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1');
    expect(setOutputFormatSaving).toHaveBeenCalledWith(true);
    expect(setEditingOutputFormatTaskId).toHaveBeenCalledWith(null);
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(null);
    expect(setOutputFormatDraft).toHaveBeenCalledWith('');
    expect(setOutputFormatSaving).toHaveBeenCalledWith(false);
  });

  it('starts save-and-close only when draft is not empty', () => {
    const { result } = buildHandler();

    act(() => {
      result.current.saveAndCloseOutputFormatDialog();
    });

    expect(updateOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1', {
      formatGuide: 'Draft text',
    });
    expect(setEditingOutputFormatTaskId).toHaveBeenCalledWith(null);
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(null);
    expect(setOutputFormatDraft).toHaveBeenCalledWith('');
    expect(setOutputFormatLoading).toHaveBeenCalledWith(false);
    expect(setOutputFormatSaving).toHaveBeenCalledWith(false);
    expect(setOutputFormatGenerating).toHaveBeenCalledWith(false);
  });

  it('saves baseline only for completed tasks and refreshes template', async () => {
    getTaskResultForNode.mockReturnValue({ status: 'completed' });

    const executionForNodeActions = makeExecution({ id: 'execution-1' });
    const { result } = buildHandler('playbook-1', 'task-1', executionForNodeActions);

    await act(async () => {
      await result.current.handleSaveBaseline('task-1');
    });

    expect(validateTaskReplay).toHaveBeenCalledWith('playbook-1', 'task-1', 'execution-1', {
      preserveOutputFormat: false,
      replayConfig: {
        replayOutputFormat: true,
        replayToolTrace: true,
        replayReasoningChain: true,
      },
    });
    expect(grabOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1', { executionId: 'execution-1' });
    expect(onBaselineSaved).toHaveBeenCalledWith('task-1');
  });

  it('does not save baseline for incomplete tasks', async () => {
    getTaskResultForNode.mockReturnValue({ status: 'running' });

    const { result } = buildHandler('playbook-1', 'task-1', makeExecution());

    await act(async () => {
      await result.current.handleSaveBaseline('task-1');
    });

    expect(validateTaskReplay).not.toHaveBeenCalled();
    expect(grabOutputFormatTemplate).not.toHaveBeenCalled();
    expect(onBaselineSaved).not.toHaveBeenCalled();
  });

  it('enables baseline action only when task result is completed', () => {
    const execution = makeExecution();
    getTaskResultForNode.mockImplementation((nodeId: string) => {
      if (nodeId === 'task-1') {
        return { status: 'completed' };
      }

      return null;
    });

    const { result } = buildHandler('playbook-1', 'task-1', execution);

    expect(result.current.canSaveBaseline('task-1')).toBe(true);
    expect(result.current.canSaveBaseline('task-2')).toBe(false);

    const { result: resultNoExecution } = buildHandler('playbook-1', 'task-1', null as any);
    getTaskResultForNode.mockReturnValue({ status: 'completed' });
    expect(resultNoExecution.current.canSaveBaseline('task-1')).toBe(false);
  });

  it('computes generation availability from completed output state', () => {
    getTaskResultForNode.mockImplementation((nodeId: string) => {
      if (nodeId === 'with-output') {
        return { status: 'completed', output: 'text' };
      }

      if (nodeId === 'with-components') {
        return { status: 'completed', components: [{ type: 'text' }] };
      }

      return { status: 'completed' };
    });

    const { result } = buildHandler('playbook-1', 'with-output', makeExecution());
    expect(result.current.canGenerateEditingOutputFormat).toBe(true);

    const { result: noExecutionResult } = buildHandler('playbook-1', 'with-output', null as any);
    expect(noExecutionResult.current.canGenerateEditingOutputFormat).toBe(false);

    const { result: noOutputResult } = buildHandler('playbook-1', 'task-missing', makeExecution());
    expect(noOutputResult.current.canGenerateEditingOutputFormat).toBe(false);

    const { result: componentsResult } = buildHandler('playbook-1', 'with-components', makeExecution());
    expect(componentsResult.current.canGenerateEditingOutputFormat).toBe(true);
  });

  it('saves generated output format when ready', async () => {
    getTaskResultForNode.mockReturnValue({ status: 'completed', output: 'output' });

    const { result } = buildHandler();

    await act(async () => {
      await result.current.handleGenerateOutputFormat();
    });

    expect(setOutputFormatGenerating).toHaveBeenCalledWith(true);
    expect(grabOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1', { executionId: 'exec-1' });
    expect(setOutputFormatDraft).toHaveBeenCalledWith('ready');
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(7);
    expect(setOutputFormatGenerating).toHaveBeenCalledWith(false);
  });

  it('polls while generation is pending', async () => {
    vi.useFakeTimers();
    getTaskResultForNode.mockReturnValue({ status: 'completed', output: 'output' });
    const pendingTemplate = {
      formatGuide: '',
      generationStatus: 'pending',
      templateVersion: 1,
    } as unknown as OutputFormatTemplate;
    const finalTemplate = {
      formatGuide: 'polled',
      generationStatus: 'ready',
      templateVersion: 2,
    } as unknown as OutputFormatTemplate;

    grabOutputFormatTemplate.mockResolvedValue(pendingTemplate);
    fetchOutputFormatTemplate
      .mockResolvedValueOnce(pendingTemplate)
      .mockResolvedValueOnce(finalTemplate);

    const { result } = buildHandler();

    await act(async () => {
      const promise = result.current.handleGenerateOutputFormat();
      await vi.runAllTimersAsync();
      await promise;
    });

    expect(fetchOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1');
    expect(fetchOutputFormatTemplate).toHaveBeenCalledTimes(2);
    expect(setOutputFormatDraft).toHaveBeenCalledWith('polled');
    expect(setEditingOutputFormatVersion).toHaveBeenCalledWith(2);
    expect(setOutputFormatGenerating).toHaveBeenCalledWith(false);
    vi.useRealTimers();
  });
});
