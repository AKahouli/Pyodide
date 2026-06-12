import { useCallback, type MutableRefObject } from 'react';
import type {
  AdvisorIntentApplyRequest,
  AdvisorRemediationPreviewRequest,
  AdvisorRemediationPreviewResponse,
  Playbook,
  PlaybookIntentConstructionEvent,
  PlaybookIntentConstructionStartResponse,
  PlaybookIntentConstructionStatus,
  PlaybookIntentSuggestion,
} from '../types';
import { getTopIntentSuggestion } from './playbook-intent';
import { useModuleTranslation } from '@/modules/localization';

const AUTO_APPLY_MIN_CONFIDENCE = 0.75;

interface PlaybookIntentFlowDeps {
  id: string | undefined;
  playbook: Playbook | null;
  selectedStepId: string | null;
  isDirty: boolean;
  intentValue: string;
  intentAutoApply: boolean;
  selectStep: (stepId: string | null, iterationIndex?: number) => void;
  requestPlaybookIntent: (playbookId: string, payload: { intent: string; selectedTaskId?: string }) => Promise<{ suggestions: PlaybookIntentSuggestion[] }>;
  saveNow: () => Promise<void>;
  handleApplyIntentSuggestion: (suggestion: PlaybookIntentSuggestion, options?: { replaceAll?: boolean; expectedDefinitionRevision?: number; save?: boolean; clearSuggestions?: boolean; focus?: boolean; applicationKey?: string; focusMode?: 'changed-area' | 'construction-frontier' }) => void;
  startPlaybookIntentConstruction?: (playbookId: string, payload: { intent: string; selectedTaskId?: string }, options?: { signal?: AbortSignal }) => Promise<PlaybookIntentConstructionStartResponse>;
  streamPlaybookIntentConstruction?: (playbookId: string, constructionId: string, options: { after?: number; signal?: AbortSignal; onEvent: (event: PlaybookIntentConstructionEvent) => void }) => Promise<void>;
  saveConstruction?: (options: { expectedDefinitionRevision: number; clientMutationId: string }) => Promise<void>;
  setIntentLoading: (loading: boolean) => void;
  setIntentError: (error: string) => void;
  setIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  setLastIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  addIntentSuggestionHistoryEntry: (playbookId: string, playbookName: string, suggestion: PlaybookIntentSuggestion, intent: string) => void;
  previewAdvisorRemediation: (playbookId: string, data: AdvisorRemediationPreviewRequest) => Promise<AdvisorRemediationPreviewResponse>;
  showError: (message: string) => void;
  getCurrentDefinitionRevision: () => number;
  setConstructionStatus?: (status: PlaybookIntentConstructionStatus) => void;
  setConstructionProgress?: (message: string) => void;
  setConstructionId?: (constructionId: string | null) => void;
  constructionAbortRef?: MutableRefObject<AbortController | null>;
}

interface PlaybookIntentFlowApi {
  handleSubmitIntent: () => Promise<void>;
  handleApplyAdvisorIntent: ({ mode, executionId, items, selectedTaskId }: AdvisorIntentApplyRequest) => Promise<void>;
}

export function usePlaybookIntentFlow(deps: PlaybookIntentFlowDeps): PlaybookIntentFlowApi {
  const {
    addIntentSuggestionHistoryEntry,
    getCurrentDefinitionRevision,
    handleApplyIntentSuggestion,
    id,
    intentAutoApply,
    intentValue,
    isDirty,
    playbook,
    previewAdvisorRemediation,
    requestPlaybookIntent,
    saveNow,
    saveConstruction,
    selectStep,
    selectedStepId,
    setIntentError,
    setIntentLoading,
    setIntentSuggestions,
    setLastIntentSuggestions,
    showError,
    startPlaybookIntentConstruction,
    streamPlaybookIntentConstruction,
    setConstructionStatus,
    setConstructionProgress,
    setConstructionId,
    constructionAbortRef,
  } = deps;
  const { t } = useModuleTranslation('playbook');

  const runIntentAnalysis = useCallback(async (
    intent: string,
    selectedTaskId?: string,
    options?: { includeFallback?: boolean },
  ): Promise<{ expectedDefinitionRevision: number; suggestions: PlaybookIntentSuggestion[]; topSuggestion: PlaybookIntentSuggestion | null } | null> => {
    if (!id || !playbook) return null;

    let expectedDefinitionRevision = playbook.definitionRevision;
    if (isDirty) {
      await saveNow();
      expectedDefinitionRevision = getCurrentDefinitionRevision();
    }

    const result = await requestPlaybookIntent(id, {
      intent,
      selectedTaskId,
    });
    const suggestions = result.suggestions || [];

    return {
      expectedDefinitionRevision,
      suggestions,
      topSuggestion: getTopIntentSuggestion(suggestions, options),
    };
  }, [getCurrentDefinitionRevision, id, isDirty, playbook, requestPlaybookIntent, saveNow]);

  const runRealtimeConstruction = useCallback(async (intent: string, selectedTaskId?: string) => {
    if (!id || !playbook) return false;
    if (!startPlaybookIntentConstruction || !streamPlaybookIntentConstruction || !saveConstruction || !constructionAbortRef) return false;
    let expectedDefinitionRevision = playbook.definitionRevision;
    if (isDirty) {
      await saveNow();
      expectedDefinitionRevision = getCurrentDefinitionRevision();
    }

    const abortController = new AbortController();
    constructionAbortRef.current = abortController;
    setConstructionStatus?.('starting');
    setConstructionProgress?.(t('intentBar.construction.starting'));
    const construction = await startPlaybookIntentConstruction(id, { intent, selectedTaskId }, { signal: abortController.signal });
    const baseDefinitionRevision = construction.baseDefinitionRevision ?? expectedDefinitionRevision;
    setConstructionId?.(construction.constructionId);
    setConstructionStatus?.('streaming');

    let appliedDelta = false;
    let lastSequence = 0;
    const appliedKeys = new Set<string>();
    try {
      await streamPlaybookIntentConstruction(id, construction.constructionId, {
        signal: abortController.signal,
        onEvent: (event) => {
          lastSequence = Math.max(lastSequence, event.sequence);
          const key = `${event.constructionId}:${event.sequence}`;
          if (appliedKeys.has(key)) return;
          appliedKeys.add(key);
          if (event.type === 'progress') setConstructionProgress?.(event.message);
          if (event.type === 'node_delta' || event.type === 'edge_delta' || event.type === 'data_binding_delta') {
            appliedDelta = true;
            handleApplyIntentSuggestion(event.suggestion, {
              expectedDefinitionRevision: baseDefinitionRevision,
              save: false,
              clearSuggestions: false,
              focus: true,
              applicationKey: `intent-construction-${event.constructionId}-${event.suggestion.id}`,
              focusMode: 'construction-frontier',
            });
          }
          if (event.type === 'failed') throw new Error(event.message);
        },
      });
    } catch (error) {
      if (appliedDelta) {
        throw Object.assign(error instanceof Error ? error : new Error(t('intentBar.error')), { appliedDelta: true });
      }
      throw error;
    }

    if (abortController.signal.aborted) {
      setConstructionStatus?.('cancelled');
      return true;
    }
    if (lastSequence > 0) {
      await saveConstruction({
        expectedDefinitionRevision: baseDefinitionRevision,
        clientMutationId: `intent-construction-${construction.constructionId}`,
      });
    }
    setConstructionStatus?.('completed');
    setConstructionProgress?.(t('intentBar.construction.completed'));
    return appliedDelta;
  }, [constructionAbortRef, getCurrentDefinitionRevision, handleApplyIntentSuggestion, id, isDirty, playbook, saveConstruction, saveNow, setConstructionId, setConstructionProgress, setConstructionStatus, startPlaybookIntentConstruction, streamPlaybookIntentConstruction, t]);

  const handleSubmitIntent = useCallback(async () => {
    const normalizedIntent = intentValue.trim();
    if (!id || !playbook || normalizedIntent.length < 3) {
      return;
    }

    const resolvedSelectedTaskId = selectedStepId && playbook?.tasks.some((task) => task.id === selectedStepId)
      ? selectedStepId
      : undefined;

    if (selectedStepId && !resolvedSelectedTaskId) {
      selectStep(null);
    }

    setIntentLoading(true);
    setIntentError('');
    try {
      if (intentAutoApply) {
        try {
          const applied = await runRealtimeConstruction(normalizedIntent, resolvedSelectedTaskId);
          if (applied) {
            setLastIntentSuggestions([]);
            setIntentSuggestions([]);
            return;
          }
        } catch (error) {
          if (constructionAbortRef?.current?.signal.aborted) return;
          setConstructionStatus?.('failed');
          setConstructionProgress?.('');
          if ((error as { appliedDelta?: boolean }).appliedDelta) {
            throw error;
          }
          if (error instanceof Error) setIntentError(error.message);
        }
      }

      const analysis = await runIntentAnalysis(normalizedIntent, resolvedSelectedTaskId);
      if (!analysis) return;

      const {
        expectedDefinitionRevision,
        suggestions: newSuggestions,
        topSuggestion,
      } = analysis;
      if (intentAutoApply && topSuggestion && topSuggestion.confidence >= AUTO_APPLY_MIN_CONFIDENCE) {
        addIntentSuggestionHistoryEntry(id, playbook?.name ?? '', topSuggestion, normalizedIntent);
        handleApplyIntentSuggestion(topSuggestion, { expectedDefinitionRevision });
        setLastIntentSuggestions([]);
        setIntentSuggestions([]);
      } else {
        setLastIntentSuggestions(newSuggestions);
        setIntentSuggestions(newSuggestions);
      }
    } catch (error) {
      setIntentSuggestions([]);
      setLastIntentSuggestions([]);
      setIntentError(error instanceof Error ? error.message : t('intentBar.error'));
    } finally {
      setIntentLoading(false);
    }
  }, [addIntentSuggestionHistoryEntry, constructionAbortRef, handleApplyIntentSuggestion, id, intentAutoApply, intentValue, playbook, runIntentAnalysis, runRealtimeConstruction, selectStep, selectedStepId, setConstructionProgress, setConstructionStatus, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, t]);

  const handleApplyAdvisorIntent = useCallback(async ({ mode, executionId, items, selectedTaskId }: AdvisorIntentApplyRequest) => {
    if (!id || !playbook) return;

    if (selectedTaskId && !playbook.tasks.some((task) => task.id === selectedTaskId)) {
      const message = t('detail.remediation.targetMissing');
      setIntentError(message);
      throw new Error(message);
    }

    const resolvedSelectedTaskId = selectedTaskId;

    setIntentLoading(true);
    setIntentError('');
    try {
      const preview = await previewAdvisorRemediation(id, {
        mode,
        executionId,
        items,
        targetTaskId: resolvedSelectedTaskId,
      });
      if (mode === 'optimize-step' && (
        preview.suggestion.kind !== 'single_change'
        || preview.suggestion.operationType !== 'update_node'
        || preview.suggestion.targetTaskId !== resolvedSelectedTaskId
      )) {
        setLastIntentSuggestions(preview.suggestions);
        setIntentSuggestions(preview.suggestions);
        throw new Error(t('detail.remediation.noApplicableSuggestion'));
      }

      addIntentSuggestionHistoryEntry(id, playbook.name, preview.suggestion, preview.intent);
      handleApplyIntentSuggestion(preview.suggestion, { expectedDefinitionRevision: preview.expectedDefinitionRevision });
      setLastIntentSuggestions([]);
      setIntentSuggestions([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('intentBar.error');
      setIntentError(message);
      showError(message);
      throw error;
    } finally {
      setIntentLoading(false);
    }
  }, [addIntentSuggestionHistoryEntry, handleApplyIntentSuggestion, id, playbook, previewAdvisorRemediation, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, showError, t]);

  return {
    handleSubmitIntent,
    handleApplyAdvisorIntent,
  };
}
