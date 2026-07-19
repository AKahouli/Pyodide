import { useCallback, type MutableRefObject } from 'react';
import type {
  AdvisorIntentApplyRequest,
  Playbook,
  PlaybookIntentImageInput,
  PlaybookIntentConstructionEvent,
  PlaybookIntentConstructionStartResponse,
  PlaybookIntentConstructionStatus,
  PlaybookIntentDesignResponse,
  PlaybookIntentSuggestion,
} from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface PlaybookIntentFlowDeps {
  id: string | undefined;
  playbook: Playbook | null;
  selectedStepId: string | null;
  isDirty: boolean;
  intentValue: string;
  intentDesign: PlaybookIntentDesignResponse | null;
  selectStep: (stepId: string | null, iterationIndex?: number) => void;
  assessPlaybookIntentDesign: (playbookId: string, payload: { intent: string; selectedTaskId?: string; images?: PlaybookIntentImageInput[] }) => Promise<PlaybookIntentDesignResponse>;
  saveNow: () => Promise<void>;
  handleApplyIntentSuggestion: (suggestion: PlaybookIntentSuggestion, options?: { replaceAll?: boolean; expectedDefinitionRevision?: number; save?: boolean; clearSuggestions?: boolean; focus?: boolean; applicationKey?: string; focusMode?: 'changed-area' | 'construction-frontier'; connectAnchors?: boolean; captureHistory?: boolean; confirmDeletes?: boolean }) => void;
  startPlaybookIntentConstruction?: (playbookId: string, payload: { intent: string; selectedTaskId?: string; images?: PlaybookIntentImageInput[] }, options?: { signal?: AbortSignal }) => Promise<PlaybookIntentConstructionStartResponse>;
  streamPlaybookIntentConstruction?: (playbookId: string, constructionId: string, options: { after?: number; signal?: AbortSignal; onEvent: (event: PlaybookIntentConstructionEvent) => void }) => Promise<void>;
  captureConstructionSnapshot?: () => void;
  rollbackConstruction?: () => void;
  finalizeConstruction?: (baseDefinitionRevision: number, constructionId: string) => Promise<void>;
  setIntentLoading: (loading: boolean) => void;
  setIntentError: (error: string) => void;
  setIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  setLastIntentSuggestions: (suggestions: PlaybookIntentSuggestion[]) => void;
  setIntentDesign: (design: PlaybookIntentDesignResponse | null) => void;
  startAdvisorRemediationConstruction?: (playbookId: string, data: { mode: AdvisorIntentApplyRequest['mode']; executionId: string; items: AdvisorIntentApplyRequest['items']; selectedTaskId?: string; expectedDefinitionRevision: number }) => Promise<PlaybookIntentConstructionStartResponse>;
  setPreviewConstructionReady?: (operationId: string, baseDefinitionRevision: number) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  getCurrentDefinitionRevision: () => number;
  setConstructionStatus?: (status: PlaybookIntentConstructionStatus) => void;
  setConstructionProgress?: (message: string) => void;
  setConstructionId?: (constructionId: string | null) => void;
  constructionAbortRef?: MutableRefObject<AbortController | null>;
  realtimeConstructionEnabled?: boolean;
}

interface PlaybookIntentFlowApi {
  handleSubmitIntent: () => Promise<IntentSubmitResult>;
  handleSubmitIntentText: (intentText: string, images?: PlaybookIntentImageInput[]) => Promise<IntentSubmitResult>;
  handleForceGenerateIntent: (answerText?: string) => Promise<IntentSubmitResult>;
  handleForceGenerateIntentText: (intentText: string, answerText?: string, images?: PlaybookIntentImageInput[]) => Promise<IntentSubmitResult>;
  handleApplyAdvisorIntent: ({ mode, executionId, items, selectedTaskId }: AdvisorIntentApplyRequest) => Promise<void>;
  consumePlaybookConstruction: (construction: PlaybookIntentConstructionStartResponse) => Promise<IntentSubmitResult>;
}

export type IntentSubmitResult = {
  status: 'completed' | 'failed' | 'needs_clarification' | 'skipped';
  error?: string;
};

export function usePlaybookIntentFlow(deps: PlaybookIntentFlowDeps): PlaybookIntentFlowApi {
  const {
    assessPlaybookIntentDesign,
    getCurrentDefinitionRevision,
    handleApplyIntentSuggestion,
    id,
    intentDesign,
    intentValue,
    isDirty,
    playbook,
    startAdvisorRemediationConstruction,
    saveNow,
    captureConstructionSnapshot,
    rollbackConstruction,
    finalizeConstruction,
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
    realtimeConstructionEnabled = true,
    setPreviewConstructionReady,
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

  const runRealtimeConstruction = useCallback(async (intent: string, selectedTaskId?: string, images?: PlaybookIntentImageInput[], existingConstruction?: PlaybookIntentConstructionStartResponse) => {
    if (!id || !playbook) return 'empty' as const;
    if (!startPlaybookIntentConstruction || !streamPlaybookIntentConstruction || !constructionAbortRef) throw new Error(t('intentBar.error'));

    const abortController = new AbortController();
    constructionAbortRef.current = abortController;
    setConstructionStatus?.('starting');
    setConstructionProgress?.(t('intentBar.construction.starting'));

    let expectedDefinitionRevision = existingConstruction?.baseDefinitionRevision ?? playbook.definitionRevision;
    if (!existingConstruction && isDirty) {
      await saveNow();
      if (abortController.signal.aborted) {
        setConstructionStatus?.('cancelled');
        return 'cancelled' as const;
      }
      expectedDefinitionRevision = getCurrentDefinitionRevision();
    }

    if (abortController.signal.aborted) {
      setConstructionStatus?.('cancelled');
      return 'cancelled' as const;
    }

    const construction = existingConstruction ?? await startPlaybookIntentConstruction(id, {
      intent,
      selectedTaskId,
      ...(images?.length ? { images } : {}),
    }, { signal: abortController.signal });
    let baseDefinitionRevision = construction.baseDefinitionRevision ?? expectedDefinitionRevision;
    setConstructionId?.(construction.constructionId);
    setConstructionStatus?.('streaming');

    let appliedDelta = false;
    let completed = false;
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
          if (event.type === 'started') baseDefinitionRevision = event.baseDefinitionRevision;
          if (event.type === 'progress') setConstructionProgress?.(event.message);
          if (event.type === 'node_delta' || event.type === 'edge_delta' || event.type === 'data_binding_delta') {
            if (construction.target === 'advisor_preview' && construction.advisorMode === 'optimize-step' && (
              event.suggestion.kind !== 'single_change'
              || event.suggestion.operationType !== 'update_node'
              || event.suggestion.targetTaskId !== selectedTaskId
            )) {
              throw new Error(t('detail.remediation.noApplicableSuggestion'));
            }
            if (!appliedDelta) captureConstructionSnapshot?.();
            appliedDelta = true;
            handleApplyIntentSuggestion(event.suggestion, {
              replaceAll: false,
              expectedDefinitionRevision: baseDefinitionRevision,
              save: false,
              clearSuggestions: false,
              focus: true,
              applicationKey: `intent-construction-${construction.constructionId}`,
              focusMode: 'construction-frontier',
              connectAnchors: true,
              captureHistory: false,
              confirmDeletes: false,
            });
          }
          if (event.type === 'completed') completed = true;
          if (event.type === 'cancelled') {
            throw Object.assign(new Error(event.reason || t('intentBar.error')), { constructionCancelled: true });
          }
          if (event.type === 'failed') throw new Error(event.message);
        },
      });
    } catch (error) {
      if ((error as { constructionCancelled?: boolean }).constructionCancelled) {
        if (appliedDelta) rollbackConstruction?.();
        setConstructionStatus?.('cancelled');
        setConstructionProgress?.('');
        return 'cancelled' as const;
      }
      if (appliedDelta) {
        rollbackConstruction?.();
        throw Object.assign(error instanceof Error ? error : new Error(t('intentBar.error')), { appliedDelta: true });
      }
      throw error;
    }

    if (abortController.signal.aborted) {
      if (appliedDelta) rollbackConstruction?.();
      setConstructionStatus?.('cancelled');
      return 'cancelled' as const;
    }
    if (!completed) {
      if (appliedDelta) rollbackConstruction?.();
      throw Object.assign(new Error(t('intentBar.error')), appliedDelta ? { appliedDelta: true } : {});
    }
    if (lastSequence > 0 && appliedDelta && construction.target === 'advisor_preview') {
      setPreviewConstructionReady?.(construction.constructionId, baseDefinitionRevision);
    } else if (lastSequence > 0 && appliedDelta) {
      try {
        await finalizeConstruction?.(baseDefinitionRevision, construction.constructionId);
      } catch (error) {
        rollbackConstruction?.();
        throw Object.assign(error instanceof Error ? error : new Error(t('intentBar.error')), { appliedDelta: true });
      }
    }
    setConstructionStatus?.('completed');
    setConstructionProgress?.(t('intentBar.construction.completed'));
    return appliedDelta ? 'applied' as const : 'empty' as const;
  }, [captureConstructionSnapshot, constructionAbortRef, finalizeConstruction, getCurrentDefinitionRevision, handleApplyIntentSuggestion, id, isDirty, playbook, rollbackConstruction, saveNow, setConstructionId, setConstructionProgress, setConstructionStatus, setPreviewConstructionReady, startPlaybookIntentConstruction, streamPlaybookIntentConstruction, t]);

  const consumePlaybookConstruction = useCallback(async (construction: PlaybookIntentConstructionStartResponse): Promise<IntentSubmitResult> => {
    setIntentLoading(true);
    setIntentError('');
    try {
      const outcome = await runRealtimeConstruction('', undefined, undefined, construction);
      return { status: outcome === 'cancelled' ? 'skipped' : 'completed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : t('intentBar.error');
      setConstructionStatus?.('failed');
      setConstructionProgress?.('');
      setIntentError(message);
      return { status: 'failed', error: message };
    } finally {
      setIntentLoading(false);
    }
  }, [runRealtimeConstruction, setConstructionProgress, setConstructionStatus, setIntentError, setIntentLoading, t]);

  const generateWithConstructionFallback = useCallback(async (normalizedIntent: string, selectedTaskId?: string, images?: PlaybookIntentImageInput[]) => {
    if (!realtimeConstructionEnabled) throw new Error(t('intentBar.error'));
    const outcome = await runRealtimeConstruction(normalizedIntent, selectedTaskId, images);
    if (outcome === 'cancelled') return 'skipped' as const;
    return 'completed' as const;
  }, [realtimeConstructionEnabled, runRealtimeConstruction, t]);

  const handleForceGenerateIntentText = useCallback(async (intentText: string, answerText?: string, images?: PlaybookIntentImageInput[]) => {
    const normalizedIntent = buildIntentWithDesignAnswer(intentText, answerText || '');
    if (!id || !playbook || normalizedIntent.length < 3) {
      return { status: 'skipped' as const };
    }
    setIntentLoading(true);
    setIntentError('');
    setIntentDesign(null);
    try {
      const status = await generateWithConstructionFallback(normalizedIntent, resolveSelectedTaskId(), images);
      return { status };
    } catch (error) {
      const message = error instanceof Error ? error.message : t('intentBar.error');
      setIntentSuggestions([]);
      setLastIntentSuggestions([]);
      setIntentError(message);
      return { status: 'failed' as const, error: message };
    } finally {
      setIntentLoading(false);
    }
  }, [buildIntentWithDesignAnswer, generateWithConstructionFallback, id, playbook, resolveSelectedTaskId, setIntentDesign, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, t]);

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

      const status = await generateWithConstructionFallback(normalizedIntent, resolvedSelectedTaskId, images);
      return { status };
    } catch (error) {
      const message = error instanceof Error ? error.message : t('intentBar.error');
      setIntentSuggestions([]);
      setLastIntentSuggestions([]);
      setIntentError(message);
      return { status: 'failed' as const, error: message };
    } finally {
      setIntentLoading(false);
    }
  }, [assessPlaybookIntentDesign, generateWithConstructionFallback, id, isDirty, playbook, resolveSelectedTaskId, saveNow, setIntentDesign, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, t]);

  const handleSubmitIntent = useCallback(async () => {
    return handleSubmitIntentText(intentValue);
  }, [handleSubmitIntentText, intentValue]);

  const handleApplyAdvisorIntent = useCallback(async ({ mode, executionId, items, selectedTaskId }: AdvisorIntentApplyRequest) => {
    if (!id || !playbook) return;
    if (!startAdvisorRemediationConstruction) throw new Error(t('intentBar.error'));

    if (selectedTaskId && !playbook.tasks.some((task) => task.id === selectedTaskId)) {
      const message = t('detail.remediation.targetMissing');
      setIntentError(message);
      throw new Error(message);
    }

    const resolvedSelectedTaskId = selectedTaskId;

    setIntentLoading(true);
    setIntentError('');
    try {
      const construction = await startAdvisorRemediationConstruction(id, {
        mode,
        executionId,
        items,
        selectedTaskId: resolvedSelectedTaskId,
        expectedDefinitionRevision: playbook.definitionRevision,
      });
      await runRealtimeConstruction('', resolvedSelectedTaskId, undefined, {
        ...construction,
        target: 'advisor_preview',
        origin: 'advisor',
        advisorMode: mode,
      });
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
  }, [id, playbook, runRealtimeConstruction, setIntentError, setIntentLoading, setIntentSuggestions, setLastIntentSuggestions, showError, startAdvisorRemediationConstruction, t]);

  return {
    handleSubmitIntent,
    handleSubmitIntentText,
    handleForceGenerateIntent,
    handleForceGenerateIntentText,
    handleApplyAdvisorIntent,
    consumePlaybookConstruction,
  };
}
