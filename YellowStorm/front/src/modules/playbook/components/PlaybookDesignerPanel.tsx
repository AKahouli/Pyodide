import { useEffect, useRef, useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { X, Send, RotateCcw, AlertCircle, Sparkles, Undo2, CheckCircle2, XCircle, MessageSquare, ShieldCheck, Eye, Square, Info, PanelRightOpen, SlidersHorizontal, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useModuleTranslation } from '@/modules/localization';
import {
  usePlaybookStore,
  useDesignMessages,
  useDesignMessagesLoading,
  useIsDesigning,
  useDesignerOpen,
  useCopilotMode,
  useCurrentPlaybook,
  useCurrentExecution,
  useLatestExecutionForPlaybook,
  useSelectedStep,
} from '../store';
import { useAutosave } from '../hooks/useAutosave';
import { useIsDirty } from '../store';
import { createHitlBlocker, updateNodeHitlPolicy } from '../api';
import type { HitlFeedbackScope, HitlHistoryEntry, HumanFeedbackData, InterruptType } from '../types';

interface Props {
  playbookId: string | undefined;
}

interface InterruptEntry extends HumanFeedbackData {
  id: string;
  createdAt?: string;
  respondedAt?: string | null;
}

const PROCEED_WITH_AVAILABLE_INFORMATION = 'Proceed with available information';

function getInterruptTitle(
  type: InterruptType | string,
  t: (key: 'interrupt.approvalTitle' | 'interrupt.reviewTitle' | 'interrupt.clarificationTitle') => string,
) {
  if (type === 'approval_request') return t('interrupt.approvalTitle');
  if (type === 'review_request') return t('interrupt.reviewTitle');
  return t('interrupt.clarificationTitle');
}

function getInterruptResponseText(entry: InterruptEntry, t: (key: 'interrupt.approved' | 'interrupt.rejected') => string) {
  if (entry.interruptType === 'clarification') {
    return entry.replyMessage || entry.feedback || entry.humanResponse || '';
  }
  if (entry.action === 'reply') return entry.replyMessage || entry.feedback || '';
  if (entry.approved ?? entry.humanResponse === 'approved') {
    return t('interrupt.approved');
  }
  return t('interrupt.rejected');
}

function getInterruptResponseDetail(entry: InterruptEntry, primaryText: string) {
  const detail = entry.feedback || entry.reason || '';
  if (!detail || detail === primaryText) return '';
  return detail;
}

function historyEntryToInterruptEntry(entry: HitlHistoryEntry): InterruptEntry {
  return {
    id: entry.interruptId || `${entry.taskId}-${entry.round}`,
    interruptType: entry.type,
    message: entry.message,
    status: entry.status,
    humanResponse: entry.responseAction || undefined,
    action: entry.responseAction || undefined,
    replyMessage: entry.responseMessage || undefined,
    interruptId: entry.interruptId,
    round: entry.round,
    payloadJson: entry.payloadJson,
    resumableActions: entry.resumableActions,
    taskDescription: entry.taskDescription,
    result: entry.result,
    approved: entry.responseApproved ?? undefined,
    reason: entry.responseReason || undefined,
    feedback: entry.responseFeedback || undefined,
    scope: entry.responseScope ?? entry.feedbackScopeDefault,
    remember: entry.responseRemember ?? undefined,
    blockerRuleId: entry.blockerRuleId,
    blockerKind: entry.blockerKind,
    reasonCode: entry.reasonCode,
    riskLevel: entry.riskLevel,
    downstreamNodeIds: entry.downstreamNodeIds,
    feedbackScopeDefault: entry.feedbackScopeDefault,
    memoryCandidate: entry.memoryCandidate,
    createdAt: entry.createdAt,
    respondedAt: entry.respondedAt,
  };
}

function formatMessageTime(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hasHumanAnswer(entry: InterruptEntry) {
  return entry.status === 'answered' && Boolean(getRawHumanAnswer(entry));
}

function getRawHumanAnswer(entry: InterruptEntry) {
  return entry.replyMessage || entry.feedback || entry.reason || entry.humanResponse || '';
}

function normalizeFeedbackText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasThreadAnswer(interruptThread: InterruptEntry[], feedback: string) {
  const normalized = normalizeFeedbackText(feedback);
  return interruptThread.some((entry) => hasHumanAnswer(entry) && normalizeFeedbackText(getRawHumanAnswer(entry)) === normalized);
}

function extractTaskDescriptionFeedback(taskDescription: string | undefined) {
  if (!taskDescription) return [];
  return taskDescription
    .split('\n')
    .map((line) => line.match(/^\s*Clarification from user:\s*(.+)\s*$/i)?.[1]?.trim() || '')
    .filter(Boolean);
}

function removeTaskDescriptionFeedback(taskDescription: string | undefined) {
  if (!taskDescription) return '';
  return taskDescription
    .split('\n')
    .filter((line) => !/^\s*Clarification from user:/i.test(line))
    .join('\n')
    .trim();
}

function getInterruptContextText(entry: InterruptEntry | null) {
  if (!entry) return '';
  return [removeTaskDescriptionFeedback(entry.taskDescription), entry.result].filter(Boolean).join('\n\n');
}

function getInterruptEntryKey(entry: InterruptEntry) {
  return entry.interruptId || entry.id;
}

function mergeInterruptThreads(localEntries: InterruptEntry[], computedEntries: InterruptEntry[]) {
  if (localEntries.length === 0) return computedEntries;
  if (computedEntries.length === 0) return localEntries;

  const merged = [...localEntries];
  const entryIndexes = new Map(merged.map((entry, index) => [getInterruptEntryKey(entry), index]));

  for (const computedEntry of computedEntries) {
    const key = getInterruptEntryKey(computedEntry);
    const existingIndex = entryIndexes.get(key);
    if (existingIndex === undefined) {
      entryIndexes.set(key, merged.length);
      merged.push(computedEntry);
      continue;
    }

    if (!hasHumanAnswer(merged[existingIndex]) && hasHumanAnswer(computedEntry)) {
      merged[existingIndex] = computedEntry;
    }
  }

  return merged;
}

export function PlaybookDesignerPanel({ playbookId }: Props) {
  const { t } = useModuleTranslation('playbook');

  const designerOpen = useDesignerOpen();
  const copilotMode = useCopilotMode();
  const messages = useDesignMessages();
  const messagesLoading = useDesignMessagesLoading();
  const isDesigning = useIsDesigning();
  const isDirty = useIsDirty();
  const playbook = useCurrentPlaybook();
  const rawCurrentExecution = useCurrentExecution();
  const latestExecution = useLatestExecutionForPlaybook(playbookId);
  const currentPlaybookExecution = rawCurrentExecution?.playbookId === playbookId ? rawCurrentExecution : null;
  const latestExecutionHasInput = latestExecution?.waitingForHumanInput === true
    || latestExecution?.status === 'interrupted'
    || latestExecution?.taskResults.some((taskResult) => taskResult.status === 'interrupted') === true;
  const currentExecutionHasInput = currentPlaybookExecution?.waitingForHumanInput === true
    || currentPlaybookExecution?.status === 'interrupted'
    || currentPlaybookExecution?.taskResults.some((taskResult) => taskResult.status === 'interrupted') === true;
  const currentExecution = latestExecutionHasInput
    ? latestExecution
    : currentExecutionHasInput
      ? currentPlaybookExecution
      : currentPlaybookExecution ?? latestExecution;
  const selectedStepId = useSelectedStep();

  const fetchDesignMessages = usePlaybookStore((s) => s.fetchDesignMessages);
  const designPlaybook = usePlaybookStore((s) => s.designPlaybook);
  const revertToSnapshot = usePlaybookStore((s) => s.revertToSnapshot);
  const resumeExecution = usePlaybookStore((s) => s.resumeExecution);
  const disableHitlBlocker = usePlaybookStore((s) => s.disableHitlBlocker);
  const setDesignerOpen = usePlaybookStore((s) => s.setDesignerOpen);
  const setCopilotMode = usePlaybookStore((s) => s.setCopilotMode);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const stopExecution = usePlaybookStore((s) => s.stopExecution);
  const isStopping = usePlaybookStore((s) => s.isStopping);

  const { saveNow } = useAutosave();

  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmittingInterrupt, setIsSubmittingInterrupt] = useState(false);
  const [isDisablingBlocker, setIsDisablingBlocker] = useState(false);
  const [feedbackScope, setFeedbackScope] = useState<HitlFeedbackScope>('downstream_run');
  const [rememberFeedback, setRememberFeedback] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [showInterruptOptions, setShowInterruptOptions] = useState(false);
  const [localInterruptThread, setLocalInterruptThread] = useState<{
    executionId: string;
    entries: InterruptEntry[];
  } | null>(null);
  const [awaitingInterruptReply, setAwaitingInterruptReply] = useState<{
    executionId: string;
    interruptId: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollCount = useRef(0);
  const interruptComposerRef = useRef<HTMLTextAreaElement>(null);

  const interruptedTask = currentExecution?.taskResults.find(
    (taskResult) => taskResult.taskId === (currentExecution.interruptPayload?.taskId || currentExecution.currentInterruptTaskId || selectedStepId),
  ) || null;

  const interruptIterationIndex = interruptedTask?.iteration ?? 0;
  const interruptIterationCount = interruptedTask
    ? currentExecution?.taskResults.filter((tr) => tr.taskId === interruptedTask.taskId).length ?? 1
    : 0;

  const interruptEntries: InterruptEntry[] = ((interruptedTask?.components || [])
    .filter((component) => component.type === 'humanFeedback')
    .map((component, index) => ({
      id: `${interruptedTask?.taskId || 'interrupt'}-${index}`,
      ...((component.data as unknown) as HumanFeedbackData),
    })));

  const pendingHistoryEntry = currentExecution?.waitingForHumanInput
    ? currentExecution.hitlHistory?.find((entry) => entry.status === 'pending' && entry.taskId === (currentExecution.currentInterruptTaskId || entry.taskId))
    : undefined;
  const interruptPayload = currentExecution?.interruptPayload || (pendingHistoryEntry
    ? {
        type: pendingHistoryEntry.type,
        taskId: pendingHistoryEntry.taskId,
        taskTitle: pendingHistoryEntry.taskTitle,
        message: pendingHistoryEntry.message,
        threadId: currentExecution?.threadId || '',
        interruptId: pendingHistoryEntry.interruptId,
        round: pendingHistoryEntry.round,
        payloadJson: pendingHistoryEntry.payloadJson,
        resumableActions: pendingHistoryEntry.resumableActions,
        taskDescription: pendingHistoryEntry.taskDescription,
        result: pendingHistoryEntry.result,
        blockerRuleId: pendingHistoryEntry.blockerRuleId,
        blockerKind: pendingHistoryEntry.blockerKind,
        reasonCode: pendingHistoryEntry.reasonCode,
        riskLevel: pendingHistoryEntry.riskLevel,
        downstreamNodeIds: pendingHistoryEntry.downstreamNodeIds,
      }
    : null);
  const currentInterruptTaskId = interruptPayload?.taskId || currentExecution?.currentInterruptTaskId || selectedStepId;
  const historyInterruptEntries = (currentExecution?.hitlHistory || [])
    .filter((entry) => !currentInterruptTaskId || entry.taskId === currentInterruptTaskId)
    .map(historyEntryToInterruptEntry);
  const activeInterruptEntry: InterruptEntry | null = interruptEntries.find((entry) => entry.status === 'pending')
    || (interruptPayload
      ? {
          id: `${interruptPayload.taskId}-${interruptPayload.interruptId || 'active'}`,
          interruptType: interruptPayload.type,
          message: interruptPayload.message,
          status: 'pending' as const,
          interruptId: interruptPayload.interruptId || '',
          taskDescription: interruptPayload.taskDescription || '',
          result: interruptPayload.result || '',
          blockerRuleId: interruptPayload.blockerRuleId,
          blockerKind: interruptPayload.blockerKind,
          reasonCode: interruptPayload.reasonCode,
          riskLevel: interruptPayload.riskLevel,
          downstreamNodeIds: interruptPayload.downstreamNodeIds,
          scope: interruptPayload.feedbackScopeDefault,
          approved: undefined,
          humanResponse: undefined,
        }
      : null);

  const hasActiveEntryInHistory = activeInterruptEntry
    ? historyInterruptEntries.some((entry) => entry.interruptId === activeInterruptEntry.interruptId)
    : false;
  const computedInterruptThread = historyInterruptEntries.length > 0
    ? [
        ...historyInterruptEntries,
        ...(activeInterruptEntry && !hasActiveEntryInHistory ? [activeInterruptEntry] : []),
      ]
    : interruptEntries.length > 0
      ? interruptEntries
      : activeInterruptEntry
        ? [activeInterruptEntry]
        : [];
  const rememberedThread = localInterruptThread;
  const localThreadEntries = rememberedThread && rememberedThread.executionId === currentExecution?.id
    ? rememberedThread.entries
    : [];
  const interruptThread = mergeInterruptThreads(localThreadEntries, computedInterruptThread);
  const lastLocalInterruptEntry = localThreadEntries.length > 0 ? localThreadEntries[localThreadEntries.length - 1] : null;
  const isAwaitingInterruptReply = Boolean(awaitingInterruptReply && awaitingInterruptReply.executionId === currentExecution?.id);
  const composerInterruptEntry = activeInterruptEntry || (isAwaitingInterruptReply ? lastLocalInterruptEntry : null);
  const isInterruptBusy = isSubmittingInterrupt || isAwaitingInterruptReply;
  const isRunningAfterHitl = Boolean(
    currentExecution
      && interruptThread.length > 0
      && !composerInterruptEntry
      && !currentExecution.waitingForHumanInput
      && currentExecution.status === 'running',
  );
  const pendingInterrupts = currentExecution?.pendingInterrupts || [];
  const queuedInterrupts = pendingInterrupts.filter((entry) => (
    entry.interruptId !== activeInterruptEntry?.interruptId
  ));
  // Actual pending human input must win over stale UI mode so the sidebar opens on live interrupts without a refresh.
  const effectiveCopilotMode = (activeInterruptEntry || interruptThread.length > 0 || currentExecution?.waitingForHumanInput)
    ? 'interrupt'
    : copilotMode;

  const scrollCount = effectiveCopilotMode === 'design' ? messages.length + (isDesigning ? 1 : 0) : interruptThread.length;

  useEffect(() => {
    if (designerOpen && copilotMode === 'design' && playbookId) {
      fetchDesignMessages(playbookId);
    }
  }, [designerOpen, copilotMode, playbookId, fetchDesignMessages]);

  useEffect(() => {
    if (scrollCount > prevScrollCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevScrollCount.current = scrollCount;
  }, [scrollCount]);

  useEffect(() => {
    if (!designerOpen || copilotMode !== 'interrupt' || !interruptPayload?.taskId) {
      return;
    }
    selectStep(interruptPayload.taskId);
  }, [designerOpen, copilotMode, interruptPayload?.taskId, selectStep]);

  useEffect(() => {
    if (!activeInterruptEntry) return;
    const isSensitiveApproval = activeInterruptEntry.interruptType === 'approval_request'
      && (activeInterruptEntry.riskLevel === 'high' || activeInterruptEntry.riskLevel === 'critical');
    setFeedbackScope(activeInterruptEntry.scope ?? (isSensitiveApproval ? 'step_only' : 'downstream_run'));
    setRememberFeedback(false);
  }, [activeInterruptEntry?.interruptId, activeInterruptEntry?.interruptType, activeInterruptEntry?.riskLevel, activeInterruptEntry?.scope]);

  useEffect(() => {
    if (!activeInterruptEntry || !awaitingInterruptReply) return;
    if (activeInterruptEntry.interruptId !== awaitingInterruptReply.interruptId) {
      setAwaitingInterruptReply(null);
    }
  }, [activeInterruptEntry?.interruptId, awaitingInterruptReply]);

  useEffect(() => {
    if (!awaitingInterruptReply || currentExecution?.id !== awaitingInterruptReply.executionId) return;
    if (!activeInterruptEntry && !currentExecution.waitingForHumanInput) {
      setAwaitingInterruptReply(null);
    }
  }, [activeInterruptEntry, awaitingInterruptReply, currentExecution?.id, currentExecution?.waitingForHumanInput]);

  useEffect(() => {
    if (!designerOpen || copilotMode !== 'interrupt') return;
    if (!activeInterruptEntry || activeInterruptEntry.interruptType === 'approval_request') return;
    const frame = window.requestAnimationFrame(() => {
      const composer = interruptComposerRef.current;
      if (typeof composer?.scrollIntoView === 'function') {
        composer.scrollIntoView({ block: 'nearest' });
      }
      composer?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeInterruptEntry?.interruptId, activeInterruptEntry?.interruptType, copilotMode, designerOpen]);

  const handleSubmitDesign = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !playbookId || isDesigning) return;

    const q = query.trim();
    setQuery('');

    if (isDirty) await saveNow();

    try {
      await designPlaybook(playbookId, { query: q });
    } catch {
      // handled in store
    }
  }, [query, playbookId, isDesigning, isDirty, saveNow, designPlaybook]);

  const handleRevert = useCallback(async (messageId: string) => {
    if (!playbookId) return;
    try {
      await revertToSnapshot(playbookId, messageId);
    } catch {
      // handled in store
    }
  }, [playbookId, revertToSnapshot]);

  const handleInterruptSubmit = useCallback(async (
    action: 'reply' | 'approve' | 'reject',
    extra?: { reason?: string; feedback?: string; message?: string },
    options?: { scope?: HitlFeedbackScope; remember?: boolean },
  ) => {
    if (!playbookId || !currentExecution || !activeInterruptEntry) return;

    setIsSubmittingInterrupt(true);
    const responseMessage = extra?.message || extra?.feedback || extra?.reason || '';
    const responseScope = options?.scope ?? feedbackScope;
    const responseRemember = options?.remember ?? rememberFeedback;
    const previousThreadEntries = interruptThread.length > 0 ? interruptThread : [activeInterruptEntry];
    try {
      const answeredEntry: InterruptEntry = {
        ...activeInterruptEntry,
        status: 'answered',
        action,
        humanResponse: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action,
        replyMessage: responseMessage,
        approved: action === 'approve' ? true : action === 'reject' ? false : activeInterruptEntry.approved,
        reason: extra?.reason || activeInterruptEntry.reason,
        feedback: extra?.feedback || activeInterruptEntry.feedback,
        scope: responseScope,
        remember: responseRemember,
        respondedAt: new Date().toISOString(),
      };
      setLocalInterruptThread({
        executionId: currentExecution.id,
        entries: previousThreadEntries.map((entry) => (
          entry.interruptId === activeInterruptEntry.interruptId ? answeredEntry : entry
        )),
      });
      setAwaitingInterruptReply({
        executionId: currentExecution.id,
        interruptId: activeInterruptEntry.interruptId || activeInterruptEntry.id,
      });
      setResponse('');
      setRejectReason('');
      await resumeExecution(playbookId, {
        executionId: currentExecution.id,
        taskId: interruptPayload?.taskId || interruptedTask?.taskId || '',
        interruptId: interruptPayload?.interruptId || activeInterruptEntry.interruptId,
        action,
        message: extra?.message,
        approved: action === 'approve' ? true : action === 'reject' ? false : undefined,
        reason: extra?.reason,
        feedback: extra?.feedback,
        scope: responseScope,
        remember: responseRemember,
      });
      setRememberFeedback(false);
      setShowRejectReason(false);
      setShowInterruptOptions(false);
    } catch {
      setAwaitingInterruptReply(null);
      setLocalInterruptThread({
        executionId: currentExecution.id,
        entries: previousThreadEntries,
      });
      setResponse(responseMessage);
      setRejectReason(extra?.reason || '');
      setFeedbackScope(responseScope);
      setRememberFeedback(responseRemember);
      // handled in store
    } finally {
      setIsSubmittingInterrupt(false);
    }
  }, [playbookId, currentExecution, activeInterruptEntry, interruptPayload?.taskId, interruptPayload?.interruptId, interruptedTask?.taskId, interruptThread, resumeExecution, feedbackScope, rememberFeedback]);

  const handleQuickResume = useCallback(async (scope: HitlFeedbackScope) => {
    await handleInterruptSubmit('reply', {
      message: PROCEED_WITH_AVAILABLE_INFORMATION,
      feedback: PROCEED_WITH_AVAILABLE_INFORMATION,
    }, { scope, remember: false });
  }, [handleInterruptSubmit]);

  const handleDisableSmartHitlForNode = useCallback(async () => {
    const nodeId = interruptPayload?.taskId || interruptedTask?.taskId;
    if (!playbookId || !nodeId) return;
    await updateNodeHitlPolicy(playbookId, nodeId, {
      mode: 'off',
      disabledReason: 'Disabled from run-mode HITL assistant.',
    });
  }, [interruptPayload?.taskId, interruptedTask?.taskId, playbookId]);

  const handleSaveWorkflowRule = useCallback(async () => {
    if (!playbookId || !activeInterruptEntry) return;
    const label = activeInterruptEntry.reasonCode || activeInterruptEntry.blockerKind || activeInterruptEntry.message || t('interrupt.saveWorkflowRule');
    await createHitlBlocker(playbookId, {
      scope: 'workflow',
      nodeId: null,
      enabled: true,
      kind: 'custom',
      label: String(label).slice(0, 80),
      description: activeInterruptEntry.message || String(label),
      action: activeInterruptEntry.interruptType === 'approval_request' ? 'approve' : 'clarify',
      riskLevel: (activeInterruptEntry.riskLevel === 'low' || activeInterruptEntry.riskLevel === 'high' || activeInterruptEntry.riskLevel === 'critical')
        ? activeInterruptEntry.riskLevel
        : 'medium',
      sensitivity: 'balanced',
      matcherType: 'llm_judge',
      matcherConfig: { interruptId: activeInterruptEntry.interruptId, reasonCode: activeInterruptEntry.reasonCode },
    });
  }, [activeInterruptEntry, playbookId, t]);

  const handleDisableBlocker = useCallback(async () => {
    if (!currentExecution || !activeInterruptEntry?.interruptId) return;
    setIsDisablingBlocker(true);
    try {
      await disableHitlBlocker(currentExecution.id, activeInterruptEntry.interruptId);
    } catch {
      // handled in store
    } finally {
      setIsDisablingBlocker(false);
    }
  }, [activeInterruptEntry?.interruptId, currentExecution, disableHitlBlocker]);

  const handleInterruptResponseKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) {
      return;
    }

    e.preventDefault();
    if (isInterruptBusy || !activeInterruptEntry) {
      return;
    }

    void handleInterruptSubmit(
      'reply',
      { message: response || undefined, feedback: response || undefined },
    );
  }, [activeInterruptEntry, handleInterruptSubmit, isInterruptBusy, response]);

  const panelTitle = effectiveCopilotMode === 'interrupt'
    ? t('interrupt.assistantInbox')
    : t('designer.title');
  const interruptTitle = getInterruptTitle(activeInterruptEntry?.interruptType ?? interruptPayload?.type ?? 'clarification', t);
  const playbookTaskTitle = currentInterruptTaskId
    ? playbook?.tasks.find((task) => task.id === currentInterruptTaskId)?.title
    : undefined;
  const pendingInterruptTaskTitle = interruptedTask?.nodeTitle || playbookTaskTitle || interruptPayload?.taskTitle || t('copilot.pendingTaskFallback');
  const interruptContextText = getInterruptContextText(activeInterruptEntry);
  const showInterruptReopen = !designerOpen && effectiveCopilotMode === 'interrupt' && (activeInterruptEntry || interruptThread.length > 0 || currentExecution?.waitingForHumanInput);

  return (
    <>
      {showInterruptReopen && (
        <Button
          type="button"
          className="absolute right-3 top-20 z-50 gap-2 rounded-full border border-primary/30 bg-background px-3 shadow-lg"
          variant="secondary"
          size="sm"
          onClick={() => {
            setCopilotMode('interrupt');
            setDesignerOpen(true);
          }}
          aria-label={t('interrupt.reopenAssistant')}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span>{t('interrupt.reopenAssistant')}</span>
          {activeInterruptEntry && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />}
        </Button>
      )}
      <div
        className="absolute right-0 inset-y-0 w-80 sm:w-96 z-40 border-l bg-background flex flex-col transition-transform duration-300"
        style={{ transform: designerOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{panelTitle}</h3>
            {effectiveCopilotMode === 'interrupt' && activeInterruptEntry && (
              <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                {interruptTitle}
              </Badge>
            )}
          </div>
          {effectiveCopilotMode === 'interrupt' && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{pendingInterruptTaskTitle}</span>
              {interruptContextText && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-muted"
                        aria-label={t('interrupt.contextTooltip')}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-72 whitespace-pre-wrap bg-popover text-popover-foreground shadow-lg">
                      {interruptContextText}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {effectiveCopilotMode === 'interrupt' && playbookId && currentExecution && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              disabled={isStopping}
              onClick={() => void stopExecution(playbookId, currentExecution.id)}
              title={t('execution.stop')}
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDesignerOpen(false)} aria-label={t('interrupt.collapseAssistant')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {effectiveCopilotMode === 'design' ? (
          <>
            {messages.length === 0 && !messagesLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-4">
                <Sparkles className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm font-medium">{t('designer.empty')}</p>
                <p className="text-xs mt-1">{t('designer.emptyHint')}</p>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.status === 'reverted') {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground bg-background">
                      <Undo2 className="h-3 w-3" />
                      <span>{t('designer.revertedLabel')}</span>
                      <span className="text-muted-foreground/60">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-sm px-3 py-2 max-w-[85%] text-sm">
                      {msg.userQuery}
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg rounded-tl-sm px-3 py-2 max-w-[85%] space-y-1.5">
                      {msg.status === 'failed' ? (
                        <div className="flex items-center gap-1.5 text-destructive text-xs">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{msg.error || t('designer.failed')}</span>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm">{msg.aiSummary}</p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => handleRevert(msg.id)}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              {t('designer.revert')}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isDesigning && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg rounded-tl-sm px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className="flex gap-0.5">
                      {[0, 0.2, 0.4].map((delay, i) => (
                        <span
                          key={i}
                          className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
                          style={{ animationDelay: `${delay}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {interruptThread.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-4">
                <MessageSquare className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm font-medium">{t('copilot.empty')}</p>
                <p className="text-xs mt-1">{t('copilot.emptyHint')}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={() => setCopilotMode('design')}
                >
                  {t('copilot.backToDesigner')}
                </Button>
              </div>
            )}

            {activeInterruptEntry && pendingInterrupts.length > 1 && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <div className="font-medium">{t('interrupt.queueTitle', { count: pendingInterrupts.length })}</div>
                {queuedInterrupts.length > 0 && (
                  <div className="mt-1 text-muted-foreground">
                    {t('interrupt.queuePending', { count: queuedInterrupts.length })}
                  </div>
                )}
              </div>
            )}

            {interruptThread.map((entry) => {
              const isApproval = entry.interruptType === 'approval_request';
              const isReview = entry.interruptType === 'review_request';
              const wasApproved = entry.approved ?? entry.humanResponse === 'approved';
              const agentText = entry.result || entry.message;
              const responseText = getInterruptResponseText(entry, t);
              const responseDetail = getInterruptResponseDetail(entry, responseText);
              const extractedFeedback = hasHumanAnswer(entry)
                ? []
                : extractTaskDescriptionFeedback(entry.taskDescription).filter((feedback) => !hasThreadAnswer(interruptThread, feedback));

              return (
                <div key={entry.id} className="space-y-3">
                  {extractedFeedback.map((feedback, feedbackIndex) => (
                    <div key={`${entry.id}-extracted-${feedbackIndex}`} className="flex justify-end">
                      <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground shadow-sm">
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] opacity-80">
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span>{t('interrupt.you')}</span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{feedback}</p>
                        <p className="mt-1 text-[10px] opacity-70">{formatMessageTime(entry.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-start">
                    <div className="max-w-[88%] rounded-2xl rounded-tl-sm border bg-muted/50 px-3 py-2 shadow-sm">
                      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                        {isApproval ? (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        ) : isReview ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5" />
                        )}
                        <span>{t('interrupt.agent')}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{agentText}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground/70">{formatMessageTime(entry.createdAt)}</p>
                    </div>
                  </div>

                  {hasHumanAnswer(entry) && (
                    <div className="flex justify-end">
                      <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground shadow-sm">
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] opacity-80">
                          {isApproval || isReview ? (
                            wasApproved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />
                          ) : (
                            <MessageSquare className="h-3.5 w-3.5" />
                          )}
                          <span>{t('interrupt.you')}</span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{responseText}</p>
                        {responseDetail && <p className="text-xs opacity-90 whitespace-pre-wrap">{responseDetail}</p>}
                        <p className="mt-1 text-[10px] opacity-70">{formatMessageTime(entry.respondedAt)}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {effectiveCopilotMode === 'design' ? (
        <form className="border-t px-3 py-3 flex gap-2 shrink-0" onSubmit={handleSubmitDesign}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('designer.inputPlaceholder')}
            disabled={isDesigning}
            className="text-sm"
          />
          <Button type="submit" size="icon" disabled={!query.trim() || isDesigning} className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      ) : composerInterruptEntry ? (
        <div className="border-t px-3 py-3 shrink-0 space-y-3">
          <div className="rounded-lg border bg-muted/20">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-between px-3 text-xs text-muted-foreground"
              aria-expanded={showInterruptOptions}
              disabled={!activeInterruptEntry || isInterruptBusy}
              onClick={() => setShowInterruptOptions((value) => !value)}
            >
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('interrupt.options')}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showInterruptOptions ? 'rotate-180' : ''}`} />
            </Button>
            {showInterruptOptions && (
              <div className="space-y-2 border-t px-3 py-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">{t('interrupt.scopeLabel')}</label>
                  <Select value={feedbackScope} onValueChange={(value) => setFeedbackScope(value as HitlFeedbackScope)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="step_only">{t('interrupt.scope.step_only')}</SelectItem>
                      <SelectItem value="downstream_run">{t('interrupt.scope.downstream_run')}</SelectItem>
                      <SelectItem value="entire_run">{t('interrupt.scope.entire_run')}</SelectItem>
                      <SelectItem value="future_node_runs">{t('interrupt.scope.future_node_runs')}</SelectItem>
                      <SelectItem value="future_workflow_runs">{t('interrupt.scope.future_workflow_runs')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={rememberFeedback}
                    onCheckedChange={(checked) => setRememberFeedback(checked === true)}
                  />
                  <span>{t('interrupt.rememberFeedback')}</span>
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  <Button type="button" variant="ghost" size="sm" className="h-7 justify-start px-2 text-xs text-muted-foreground" disabled={isInterruptBusy} onClick={() => void handleQuickResume('entire_run')}>
                    {t('interrupt.disableForRun')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 justify-start px-2 text-xs text-muted-foreground" disabled={isInterruptBusy} onClick={() => void handleQuickResume('step_only')}>
                    {t('interrupt.disableForStep')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 justify-start px-2 text-xs text-muted-foreground" disabled={isInterruptBusy} onClick={() => void handleDisableSmartHitlForNode()}>
                    {t('interrupt.disableSmartForNode')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 justify-start px-2 text-xs text-muted-foreground" disabled={isInterruptBusy} onClick={() => void handleSaveWorkflowRule()}>
                    {t('interrupt.saveWorkflowRule')}
                  </Button>
                </div>
                {activeInterruptEntry?.blockerRuleId && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={isDisablingBlocker || isInterruptBusy} onClick={() => void handleDisableBlocker()}>
                    {t('interrupt.disableBlocker')}
                  </Button>
                )}
              </div>
            )}
          </div>
          {isAwaitingInterruptReply && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{t('interrupt.thinking')}</span>
              <span className="flex gap-0.5" aria-hidden="true">
                {[0, 0.2, 0.4].map((delay) => (
                  <span
                    key={delay}
                    className="inline-block h-1 w-1 rounded-full bg-primary animate-pulse"
                    style={{ animationDelay: `${delay}s` }}
                  />
                ))}
              </span>
            </div>
          )}
          {composerInterruptEntry.interruptType === 'approval_request' ? (
            <>
              {interruptIterationCount > 1 && (
                <Badge variant="outline" className="w-fit text-[10px]">
                  {t('interrupt.iterationContext', { current: interruptIterationIndex + 1, total: interruptIterationCount })}
                </Badge>
              )}
              {showRejectReason && (
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t('interrupt.rejectReasonPlaceholder')}
                  rows={2}
                  disabled={isInterruptBusy}
                />
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!showRejectReason) {
                      setShowRejectReason(true);
                      return;
                    }
                    void handleInterruptSubmit('reject', { reason: rejectReason || undefined });
                  }}
                  disabled={isInterruptBusy || !activeInterruptEntry}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  {t('interrupt.reject')}
                </Button>
                <Button
                  size="sm"
                  className="min-w-[180px]"
                  onClick={() => void handleInterruptSubmit('approve')}
                  disabled={isInterruptBusy || !activeInterruptEntry}
                >
                  {isInterruptBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      {t('interrupt.thinking')}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {t('interrupt.approveAndContinue')}
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Textarea
                ref={interruptComposerRef}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder={isInterruptBusy ? t('interrupt.waitingPlaceholder') : t('interrupt.responsePlaceholder')}
                rows={3}
                onKeyDown={handleInterruptResponseKeyDown}
                disabled={isInterruptBusy || !activeInterruptEntry}
                className={isInterruptBusy ? 'border-primary/50 bg-muted/30 opacity-100' : undefined}
              />
              <div className="flex items-center justify-end gap-2">
                {composerInterruptEntry.interruptType === 'review_request' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleInterruptSubmit('reply', { message: response || undefined, feedback: response || undefined })}
                    disabled={isInterruptBusy || !activeInterruptEntry || !response.trim()}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    {t('interrupt.submit')}
                  </Button>
                )}
                {composerInterruptEntry.interruptType === 'clarification' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleInterruptSubmit('reply', {
                      message: PROCEED_WITH_AVAILABLE_INFORMATION,
                      feedback: PROCEED_WITH_AVAILABLE_INFORMATION,
                    })}
                    disabled={isInterruptBusy || !activeInterruptEntry}
                  >
                    {t('interrupt.proceedWithoutMore')}
                  </Button>
                )}
                <Button
                  size="sm"
                  className={composerInterruptEntry.interruptType === 'review_request' ? 'min-w-[180px]' : undefined}
                  onClick={() => void handleInterruptSubmit(
                    composerInterruptEntry.interruptType === 'review_request' ? 'approve' : 'reply',
                    { message: response || undefined, feedback: response || undefined },
                  )}
                  disabled={isInterruptBusy || !activeInterruptEntry || (composerInterruptEntry.interruptType !== 'review_request' && !response.trim())}
                >
                    {isInterruptBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        {t('interrupt.thinking')}
                      </>
                    ) : composerInterruptEntry.interruptType === 'review_request' ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        {t('interrupt.approveAndContinue')}
                      </>
                    ) : (
                      t('interrupt.submit')
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : isRunningAfterHitl ? (
        <div className="border-t px-3 py-3 shrink-0">
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>{t('interrupt.runningWithFeedback')}</span>
            <span className="flex gap-0.5" aria-hidden="true">
              {[0, 0.2, 0.4].map((delay) => (
                <span
                  key={delay}
                  className="inline-block h-1 w-1 rounded-full bg-primary animate-pulse"
                  style={{ animationDelay: `${delay}s` }}
                />
              ))}
            </span>
          </div>
        </div>
      ) : null}
      </div>
    </>
  );
}
