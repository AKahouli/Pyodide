import { useCallback, useMemo } from 'react';

import type { Dispatch, SetStateAction } from 'react';
import type {
  OutputFormatTemplate,
  PlaybookExecution,
  UpdateOutputFormatTemplateData,
} from '../types';

export interface UsePlaybookCanvasOutputFormatHandlersParams {
  id: string | undefined;
  editingOutputFormatTaskId: string | null;
  setEditingOutputFormatTaskId: Dispatch<SetStateAction<string | null>>;
  setEditingOutputFormatVersion: Dispatch<SetStateAction<number | null>>;
  setOutputFormatDraft: Dispatch<SetStateAction<string>>;
  setOutputFormatLoading: Dispatch<SetStateAction<boolean>>;
  setOutputFormatSaving: Dispatch<SetStateAction<boolean>>;
  setOutputFormatGenerating: Dispatch<SetStateAction<boolean>>;
  fetchOutputFormatTemplate: (playbookId: string, taskId: string) => Promise<OutputFormatTemplate | null>;
  updateOutputFormatTemplate: (
    playbookId: string,
    taskId: string,
    data: UpdateOutputFormatTemplateData,
  ) => Promise<OutputFormatTemplate>;
  deleteOutputFormatTemplate: (playbookId: string, taskId: string) => Promise<{ removed: boolean }>;
  grabOutputFormatTemplate: (playbookId: string, taskId: string, data: { executionId: string }) => Promise<OutputFormatTemplate>;
  outputFormatDraft: string;
  executionForNodeActions: PlaybookExecution | null;
  getTaskResultForNode: (nodeId: string) => { status?: string; output?: string | null; components?: unknown[] | null } | null;
  onBaselineSaved?: (nodeId: string) => void;
  validateTaskReplay: (
    playbookId: string,
    taskId: string,
    executionId: string,
    options?: {
      preserveOutputFormat?: boolean;
      replayConfig?: { replayOutputFormat?: boolean; replayToolTrace?: boolean; replayReasoningChain?: boolean };
    },
  ) => Promise<unknown>;
}

export interface UsePlaybookCanvasOutputFormatHandlersResult {
  openOutputFormatEditor: (taskId: string) => Promise<void>;
  closeOutputFormatDialog: (open: boolean) => void;
  handleSaveOutputFormat: () => Promise<void>;
  handleRemoveOutputFormat: () => Promise<void>;
  saveAndCloseOutputFormatDialog: () => void;
  handleSaveBaseline: (nodeId: string) => Promise<void>;
  canSaveBaseline: (nodeId: string) => boolean;
  canGenerateEditingOutputFormat: boolean;
  handleGenerateOutputFormat: () => Promise<void>;
}

export function usePlaybookCanvasOutputFormatHandlers({
  id,
  editingOutputFormatTaskId,
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
  outputFormatDraft,
  executionForNodeActions,
  getTaskResultForNode,
  onBaselineSaved,
  validateTaskReplay,
}: UsePlaybookCanvasOutputFormatHandlersParams): UsePlaybookCanvasOutputFormatHandlersResult {
  const openOutputFormatEditor = useCallback(async (taskId: string) => {
    if (!id) return;
    setEditingOutputFormatTaskId(taskId);
    setEditingOutputFormatVersion(null);
    setOutputFormatDraft('');
    setOutputFormatLoading(true);
    try {
      const template = await fetchOutputFormatTemplate(id, taskId);
      setOutputFormatDraft(template?.formatGuide || '');
      setEditingOutputFormatVersion(template?.templateVersion || null);
    } finally {
      setOutputFormatLoading(false);
    }
  }, [fetchOutputFormatTemplate, id, setEditingOutputFormatTaskId, setEditingOutputFormatVersion, setOutputFormatDraft, setOutputFormatLoading]);

  const closeOutputFormatDialog = useCallback((open: boolean) => {
    if (open) return;
    setEditingOutputFormatTaskId(null);
    setEditingOutputFormatVersion(null);
    setOutputFormatDraft('');
    setOutputFormatLoading(false);
    setOutputFormatSaving(false);
    setOutputFormatGenerating(false);
  }, [
    setEditingOutputFormatTaskId,
    setEditingOutputFormatVersion,
    setOutputFormatDraft,
    setOutputFormatLoading,
    setOutputFormatSaving,
    setOutputFormatGenerating,
  ]);

  const handleSaveOutputFormat = useCallback(async () => {
    if (!id || !editingOutputFormatTaskId) return;
    setOutputFormatSaving(true);
    try {
      const template = await updateOutputFormatTemplate(id, editingOutputFormatTaskId, {
        formatGuide: outputFormatDraft,
      });
      setOutputFormatDraft(template.formatGuide || '');
      setEditingOutputFormatVersion(template.templateVersion);
      setEditingOutputFormatTaskId(null);
    } finally {
      setOutputFormatSaving(false);
    }
  }, [editingOutputFormatTaskId, id, outputFormatDraft, updateOutputFormatTemplate, setEditingOutputFormatTaskId, setEditingOutputFormatVersion, setOutputFormatDraft, setOutputFormatSaving]);

  const handleRemoveOutputFormat = useCallback(async () => {
    if (!id || !editingOutputFormatTaskId) return;
    setOutputFormatSaving(true);
    try {
      await deleteOutputFormatTemplate(id, editingOutputFormatTaskId);
      setEditingOutputFormatTaskId(null);
      setEditingOutputFormatVersion(null);
      setOutputFormatDraft('');
    } finally {
      setOutputFormatSaving(false);
    }
  }, [deleteOutputFormatTemplate, editingOutputFormatTaskId, id, setEditingOutputFormatTaskId, setEditingOutputFormatVersion, setOutputFormatDraft, setOutputFormatSaving]);

  const saveAndCloseOutputFormatDialog = useCallback(() => {
    if (!editingOutputFormatTaskId) return;
    if (outputFormatDraft.trim() && id) {
      void updateOutputFormatTemplate(id, editingOutputFormatTaskId, { formatGuide: outputFormatDraft });
    }
    closeOutputFormatDialog(false);
  }, [closeOutputFormatDialog, editingOutputFormatTaskId, id, outputFormatDraft, updateOutputFormatTemplate]);

  const handleSaveBaseline = useCallback(
    async (nodeId: string) => {
      if (!id || !executionForNodeActions) return;
      const taskResult = getTaskResultForNode(nodeId);
      if (!taskResult || taskResult.status !== 'completed') return;

      await validateTaskReplay(id, nodeId, executionForNodeActions.id, {
        preserveOutputFormat: false,
        replayConfig: { replayOutputFormat: true, replayToolTrace: true, replayReasoningChain: true },
      });
      try {
        await grabOutputFormatTemplate(id, nodeId, { executionId: executionForNodeActions.id });
      } catch {}
      onBaselineSaved?.(nodeId);
    },
    [executionForNodeActions, getTaskResultForNode, id, grabOutputFormatTemplate, onBaselineSaved, validateTaskReplay],
  );

  const canSaveBaseline = useCallback(
    (nodeId: string) => Boolean(executionForNodeActions && getTaskResultForNode(nodeId)?.status === 'completed'),
    [executionForNodeActions, getTaskResultForNode],
  );

  const canGenerateEditingOutputFormat = useMemo(() => {
    if (!editingOutputFormatTaskId || !executionForNodeActions) return false;
    const taskResult = getTaskResultForNode(editingOutputFormatTaskId);
    return Boolean(taskResult?.status === 'completed' && (taskResult.output || taskResult.components?.length));
  }, [editingOutputFormatTaskId, executionForNodeActions, getTaskResultForNode]);

  const handleGenerateOutputFormat = useCallback(async () => {
    if (!id || !editingOutputFormatTaskId || !executionForNodeActions) return;
    const taskResult = getTaskResultForNode(editingOutputFormatTaskId);
    if (!taskResult || taskResult.status !== 'completed' || (!taskResult.output && !(taskResult.components?.length))) return;

    setOutputFormatGenerating(true);
    try {
      const template = await grabOutputFormatTemplate(id, editingOutputFormatTaskId, { executionId: executionForNodeActions.id });

      if (template.generationStatus === 'pending') {
        setOutputFormatDraft('');
        await new Promise<void>((resolve) => {
          let attempts = 0;
          const maxAttempts = 60;
          const poll = async () => {
            if (attempts >= maxAttempts) {
              resolve();
              return;
            }
            attempts++;
            try {
              const current = await fetchOutputFormatTemplate(id, editingOutputFormatTaskId);
              if (!current || current.generationStatus !== 'pending') {
                setOutputFormatDraft(current?.formatGuide || '');
                setEditingOutputFormatVersion(current?.templateVersion || null);
                resolve();
                return;
              }
            } catch {}
            setTimeout(poll, 2000);
          };
          setTimeout(poll, 2000);
        });
      } else {
        setOutputFormatDraft(template.formatGuide || '');
        setEditingOutputFormatVersion(template.templateVersion);
      }
    } finally {
      setOutputFormatGenerating(false);
    }
  }, [
    editingOutputFormatTaskId,
    executionForNodeActions,
    fetchOutputFormatTemplate,
    getTaskResultForNode,
    grabOutputFormatTemplate,
    id,
    setEditingOutputFormatVersion,
    setOutputFormatDraft,
    setOutputFormatGenerating,
  ]);

  return {
    openOutputFormatEditor,
    closeOutputFormatDialog,
    handleSaveOutputFormat,
    handleRemoveOutputFormat,
    saveAndCloseOutputFormatDialog,
    handleSaveBaseline,
    canSaveBaseline,
    canGenerateEditingOutputFormat,
    handleGenerateOutputFormat,
  };
}
