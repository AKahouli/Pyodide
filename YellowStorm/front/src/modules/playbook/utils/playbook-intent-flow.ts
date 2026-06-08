import { useCallback } from 'react';
import type {
  AdvisorIntentApplyRequest,
  AdvisorRemediationPreviewRequest,
  AdvisorRemediationPreviewResponse,
  Playbook,
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
  handleApplyIntentSuggestion: (suggestion: PlaybookIntentSuggestion, options?: { replaceAll?: boolean; expectedDefinitionRevision?: number }) => void;
  setIntentLoading: (loading: boolean) => void;
  setIntentError: (error: string) => void;
  setIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  setLastIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  addIntentSuggestionHistoryEntry: (playbookId: string, playbookName: string, suggestion: PlaybookIntentSuggestion, intent: string) => void;
  previewAdvisorRemediation: (playbookId: string, data: AdvisorRemediationPreviewRequest) => Promise<AdvisorRemediationPreviewResponse>;
  showError: (message: string) => void;
  getCurrentDefinitionRevision: () => number;
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
    selectStep,
    selectedStepId,
    setIntentError,
    setIntentLoading,
    setIntentSuggestions,
    setLastIntentSuggestions,
    showError,
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
  }, [addIntentSuggestionHistoryEntry, handleApplyIntentSuggestion, id, intentAutoApply, intentValue, playbook, runIntentAnalysis, selectStep, selectedStepId, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, t]);

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
