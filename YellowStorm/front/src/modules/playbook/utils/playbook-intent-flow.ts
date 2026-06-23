import { useCallback, type MutableRefObject } from 'react';
import type {
  AdvisorIntentApplyRequest,
  AdvisorRemediationPreviewRequest,
  AdvisorRemediationPreviewResponse,
  Playbook,
  PlaybookIntentImageInput,
  PlaybookIntentConstructionEvent,
  PlaybookIntentConstructionStartResponse,
  PlaybookIntentConstructionStatus,
  PlaybookIntentDesignResponse,
  PlaybookIntentSuggestion,
} from '../types';
import { getTopIntentSuggestion } from './playbook-intent';
import { usePlaybookStore } from '../store';
import { getUnboundRequiredPorts } from './required-port-validation';
import { useModuleTranslation } from '@/modules/localization';

const AUTO_APPLY_MIN_CONFIDENCE = 0.75;

interface PlaybookIntentFlowDeps {
  id: string | undefined;
  playbook: Playbook | null;
  selectedStepId: string | null;
  isDirty: boolean;
  intentValue: string;
  intentAutoApply: boolean;
  intentDesign: PlaybookIntentDesignResponse | null;
  selectStep: (stepId: string | null, iterationIndex?: number) => void;
  assessPlaybookIntentDesign: (playbookId: string, payload: { intent: string; selectedTaskId?: string; images?: PlaybookIntentImageInput[] }) => Promise<PlaybookIntentDesignResponse>;
  requestPlaybookIntent: (playbookId: string, payload: { intent: string; selectedTaskId?: string; images?: PlaybookIntentImageInput[] }) => Promise<{ suggestions: PlaybookIntentSuggestion[] }>;
  saveNow: () => Promise<void>;
  handleApplyIntentSuggestion: (suggestion: PlaybookIntentSuggestion, options?: { replaceAll?: boolean; expectedDefinitionRevision?: number; save?: boolean; clearSuggestions?: boolean; focus?: boolean; applicationKey?: string; focusMode?: 'changed-area' | 'construction-frontier'; connectAnchors?: boolean }) => void;
  startPlaybookIntentConstruction?: (playbookId: string, payload: { intent: string; selectedTaskId?: string; images?: PlaybookIntentImageInput[] }, options?: { signal?: AbortSignal }) => Promise<PlaybookIntentConstructionStartResponse>;
  streamPlaybookIntentConstruction?: (playbookId: string, constructionId: string, options: { after?: number; signal?: AbortSignal; onEvent: (event: PlaybookIntentConstructionEvent) => void }) => Promise<void>;
  saveConstruction?: (options: { expectedDefinitionRevision: number; clientMutationId: string }) => Promise<void>;
  setIntentLoading: (loading: boolean) => void;
  setIntentError: (error: string) => void;
  setIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  setLastIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  setIntentDesign: (design: PlaybookIntentDesignResponse | null) => void;
  addIntentSuggestionHistoryEntry: (playbookId: string, playbookName: string, suggestion: PlaybookIntentSuggestion, intent: string) => void;
  previewAdvisorRemediation: (playbookId: string, data: AdvisorRemediationPreviewRequest) => Promise<AdvisorRemediationPreviewResponse>;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  getCurrentDefinitionRevision: () => number;
  setConstructionStatus?: (status: PlaybookIntentConstructionStatus) => void;
  setConstructionProgress?: (message: string) => void;
  setConstructionId?: (constructionId: string | null) => void;
  constructionAbortRef?: MutableRefObject<AbortController | null>;
}

interface PlaybookIntentFlowApi {
  handleSubmitIntent: () => Promise<IntentSubmitResult>;
  handleSubmitIntentText: (intentText: string, images?: PlaybookIntentImageInput[]) => Promise<IntentSubmitResult>;
  handleForceGenerateIntent: (answerText?: string) => Promise<IntentSubmitResult>;
  handleForceGenerateIntentText: (intentText: string, answerText?: string, images?: PlaybookIntentImageInput[]) => Promise<IntentSubmitResult>;
  handleApplyAdvisorIntent: ({ mode, executionId, items, selectedTaskId }: AdvisorIntentApplyRequest) => Promise<void>;
}

export type IntentSubmitResult = {
  status: 'completed' | 'failed' | 'needs_clarification' | 'skipped';
  error?: string;
};

export function usePlaybookIntentFlow(deps: PlaybookIntentFlowDeps): PlaybookIntentFlowApi {
  const {
    addIntentSuggestionHistoryEntry,
    assessPlaybookIntentDesign,
    getCurrentDefinitionRevision,
    handleApplyIntentSuggestion,
    id,
    intentAutoApply,
    intentDesign,
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
    setIntentDesign,
    setIntentLoading,
    setIntentSuggestions,
    setLastIntentSuggestions,
    showError,
    showWarning,
    startPlaybookIntentConstruction,
    streamPlaybookIntentConstruction,
    setConstructionStatus,
    setConstructionProgress,
    setConstructionId,
    constructionAbortRef,
  } = deps;
  const { t } = useModuleTranslation('playbook');

  const resolveSelectedTaskId = useCallback(() => {
    const resolvedSelectedTaskId = selectedStepId && playbook?.tasks.some((task) => task.id === selectedStepId)
      ? selectedStepId
      : undefined;
    if (selectedStepId && !resolvedSelectedTaskId) selectStep(null);
    return resolvedSelectedTaskId;
  }, [playbook?.tasks, selectStep, selectedStepId]);

  const buildIntentWithDesignAnswer = useCallback((intentText: string, answerText: string) => {
    const normalizedAnswer = answerText.trim();
    if (!normalizedAnswer) return intentText.trim();
    return `${intentText.trim()}\n\nClarifications:\n${normalizedAnswer}`;
  }, []);

  const runIntentAnalysis = useCallback(async (
    intent: string,
    selectedTaskId?: string,
    options?: { includeFallback?: boolean; images?: PlaybookIntentImageInput[] },
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
      ...(options?.images?.length ? { images: options.images } : {}),
    });
    const suggestions = result.suggestions || [];

    return {
      expectedDefinitionRevision,
      suggestions,
      topSuggestion: getTopIntentSuggestion(suggestions, options),
    };
  }, [getCurrentDefinitionRevision, id, isDirty, playbook, requestPlaybookIntent, saveNow]);

  const runRealtimeConstruction = useCallback(async (intent: string, selectedTaskId?: string, images?: PlaybookIntentImageInput[]) => {
    if (!id || !playbook) return false;
    if (!startPlaybookIntentConstruction || !streamPlaybookIntentConstruction || !saveConstruction || !constructionAbortRef) return false;

    const abortController = new AbortController();
    constructionAbortRef.current = abortController;
    setConstructionStatus?.('starting');
    setConstructionProgress?.(t('intentBar.construction.starting'));

    let expectedDefinitionRevision = playbook.definitionRevision;
    if (isDirty) {
      await saveNow();
      if (abortController.signal.aborted) {
        setConstructionStatus?.('cancelled');
        return true;
      }
      expectedDefinitionRevision = getCurrentDefinitionRevision();
    }

    if (abortController.signal.aborted) {
      setConstructionStatus?.('cancelled');
      return true;
    }

    const construction = await startPlaybookIntentConstruction(id, {
      intent,
      selectedTaskId,
      ...(images?.length ? { images } : {}),
    }, { signal: abortController.signal });
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
              connectAnchors: true,
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
      const currentPlaybook = usePlaybookStore.getState().currentPlaybook;
      const unboundRequiredPorts = currentPlaybook
        ? getUnboundRequiredPorts(currentPlaybook.tasks, currentPlaybook.dataBindings ?? [])
        : [];
      if (unboundRequiredPorts.length > 0) {
        console.warn('[IntentApply] Skipped construction save with unbound required inputs:', unboundRequiredPorts);
        showWarning(t('intentBar.invalidRequiredBindings'));
        setConstructionStatus?.('completed');
        setConstructionProgress?.(t('intentBar.construction.completed'));
        return appliedDelta;
      }
      await saveConstruction({
        expectedDefinitionRevision: getCurrentDefinitionRevision(),
        clientMutationId: `intent-construction-${construction.constructionId}`,
      });
    }
    setConstructionStatus?.('completed');
    setConstructionProgress?.(t('intentBar.construction.completed'));
    return appliedDelta;
  }, [constructionAbortRef, getCurrentDefinitionRevision, handleApplyIntentSuggestion, id, isDirty, playbook, saveConstruction, saveNow, setConstructionId, setConstructionProgress, setConstructionStatus, showWarning, startPlaybookIntentConstruction, streamPlaybookIntentConstruction, t]);

  const generateIntentSuggestions = useCallback(async (normalizedIntent: string, selectedTaskId?: string, options?: { applyBest?: boolean; images?: PlaybookIntentImageInput[] }) => {
    setConstructionStatus?.('starting');
    setConstructionProgress?.(t('intentBar.construction.starting'));
    const analysis = await runIntentAnalysis(normalizedIntent, selectedTaskId, { includeFallback: options?.applyBest, images: options?.images });
    if (!analysis) return;

    const {
      expectedDefinitionRevision,
      suggestions: newSuggestions,
      topSuggestion,
    } = analysis;
    if ((options?.applyBest || intentAutoApply) && topSuggestion && (options?.applyBest || topSuggestion.confidence >= AUTO_APPLY_MIN_CONFIDENCE) && id) {
      addIntentSuggestionHistoryEntry(id, playbook?.name ?? '', topSuggestion, normalizedIntent);
      handleApplyIntentSuggestion(topSuggestion, { expectedDefinitionRevision });
      setLastIntentSuggestions([]);
      setIntentSuggestions([]);
    } else {
      setLastIntentSuggestions(newSuggestions);
      setIntentSuggestions(newSuggestions);
    }
    setConstructionStatus?.('completed');
    setConstructionProgress?.(t('intentBar.construction.completed'));
  }, [addIntentSuggestionHistoryEntry, handleApplyIntentSuggestion, id, intentAutoApply, playbook?.name, runIntentAnalysis, setConstructionProgress, setConstructionStatus, setIntentSuggestions, setLastIntentSuggestions, t]);

  const handleForceGenerateIntentText = useCallback(async (intentText: string, answerText?: string, images?: PlaybookIntentImageInput[]) => {
    const normalizedIntent = buildIntentWithDesignAnswer(intentText, answerText || '');
    if (!id || !playbook || normalizedIntent.length < 3) {
      return { status: 'skipped' as const };
    }
    setIntentLoading(true);
    setIntentError('');
    setIntentDesign(null);
    try {
      try {
        const applied = await runRealtimeConstruction(normalizedIntent, resolveSelectedTaskId(), images);
        if (applied) {
          setLastIntentSuggestions([]);
          setIntentSuggestions([]);
          return { status: 'completed' as const };
        }
      } catch (error) {
        if (constructionAbortRef?.current?.signal.aborted) return { status: 'skipped' as const };
        setConstructionStatus?.('failed');
        setConstructionProgress?.('');
        if ((error as { appliedDelta?: boolean }).appliedDelta) {
          throw error;
        }
        if (error instanceof Error) setIntentError(error.message);
      }

      await generateIntentSuggestions(normalizedIntent, resolveSelectedTaskId(), { applyBest: true, images });
      return { status: 'completed' as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : t('intentBar.error');
      setIntentSuggestions([]);
      setLastIntentSuggestions([]);
      setIntentError(message);
      return { status: 'failed' as const, error: message };
    } finally {
      setIntentLoading(false);
    }
  }, [buildIntentWithDesignAnswer, constructionAbortRef, generateIntentSuggestions, id, playbook, resolveSelectedTaskId, runRealtimeConstruction, setConstructionProgress, setConstructionStatus, setIntentDesign, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, t]);

  const handleForceGenerateIntent = useCallback(async (answerText?: string) => {
    return handleForceGenerateIntentText(intentValue, answerText);
  }, [handleForceGenerateIntentText, intentValue]);

  const handleSubmitIntentText = useCallback(async (intentText: string, images?: PlaybookIntentImageInput[]) => {
    const normalizedIntent = intentText.trim();
    if (!id || !playbook || normalizedIntent.length < 3) {
      return { status: 'skipped' as const };
    }

    const resolvedSelectedTaskId = resolveSelectedTaskId();

    setIntentLoading(true);
    setIntentError('');
    setIntentDesign(null);
    try {
      if (intentAutoApply) {
        try {
          const applied = await runRealtimeConstruction(normalizedIntent, resolvedSelectedTaskId, images);
          if (applied) {
            setLastIntentSuggestions([]);
            setIntentSuggestions([]);
            return { status: 'completed' as const };
          }
        } catch (error) {
          if (constructionAbortRef?.current?.signal.aborted) return { status: 'skipped' as const };
          setConstructionStatus?.('failed');
          setConstructionProgress?.('');
          if ((error as { appliedDelta?: boolean }).appliedDelta) {
            throw error;
          }
          if (error instanceof Error) setIntentError(error.message);
        }
      }

      if (!intentAutoApply) {
        if (isDirty) await saveNow();
        const design = await assessPlaybookIntentDesign(id, {
          intent: normalizedIntent,
          selectedTaskId: resolvedSelectedTaskId,
          ...(images?.length ? { images } : {}),
        });
        if (design.status !== 'ready_to_generate') {
          setIntentDesign(design);
          return { status: 'needs_clarification' as const };
        }
      }

      await generateIntentSuggestions(normalizedIntent, resolvedSelectedTaskId, { images });
      return { status: 'completed' as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : t('intentBar.error');
      setIntentSuggestions([]);
      setLastIntentSuggestions([]);
      setIntentError(message);
      return { status: 'failed' as const, error: message };
    } finally {
      setIntentLoading(false);
    }
  }, [assessPlaybookIntentDesign, constructionAbortRef, generateIntentSuggestions, id, intentAutoApply, isDirty, playbook, resolveSelectedTaskId, runRealtimeConstruction, saveNow, setConstructionProgress, setConstructionStatus, setIntentDesign, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, t]);

  const handleSubmitIntent = useCallback(async () => {
    return handleSubmitIntentText(intentValue);
  }, [handleSubmitIntentText, intentValue]);

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
    handleSubmitIntentText,
    handleForceGenerateIntent,
    handleForceGenerateIntentText,
    handleApplyAdvisorIntent,
  };
}
