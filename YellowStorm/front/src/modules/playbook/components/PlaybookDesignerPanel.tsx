import { useEffect, useRef, useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { X, Send, RotateCcw, AlertCircle, Sparkles, Undo2, CheckCircle2, XCircle, MessageSquare, ShieldCheck, Eye, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import {
  usePlaybookStore,
  useDesignMessages,
  useDesignMessagesLoading,
  useIsDesigning,
  useDesignerOpen,
  useCopilotMode,
  useCurrentExecution,
  useLatestExecutionForPlaybook,
  useSelectedStep,
} from '../store';
import { useAutosave } from '../hooks/useAutosave';
import { useIsDirty } from '../store';
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

function getRiskLabel(riskLevel: string, t: (key: 'interrupt.risk.low' | 'interrupt.risk.medium' | 'interrupt.risk.high' | 'interrupt.risk.critical') => string) {
  if (riskLevel === 'low') return t('interrupt.risk.low');
  if (riskLevel === 'high') return t('interrupt.risk.high');
  if (riskLevel === 'critical') return t('interrupt.risk.critical');
  return t('interrupt.risk.medium');
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

export function PlaybookDesignerPanel({ playbookId }: Props) {
  const { t } = useModuleTranslation('playbook');

  const designerOpen = useDesignerOpen();
  const copilotMode = useCopilotMode();
  const messages = useDesignMessages();
  const messagesLoading = useDesignMessagesLoading();
  const isDesigning = useIsDesigning();
  const isDirty = useIsDirty();
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
  const [localInterruptThread, setLocalInterruptThread] = useState<{
    executionId: string;
    entries: InterruptEntry[];
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
          id: `${interruptPayload.taskId}-active`,
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
  const interruptThread = computedInterruptThread.length > 0
    ? computedInterruptThread
    : localThreadEntries;
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
  ) => {
    if (!playbookId || !currentExecution || !activeInterruptEntry) return;

    setIsSubmittingInterrupt(true);
    try {
      const responseMessage = extra?.message || extra?.feedback || extra?.reason || '';
      const answeredEntry: InterruptEntry = {
        ...activeInterruptEntry,
        status: 'answered',
        action,
        humanResponse: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action,
        replyMessage: responseMessage,
        approved: action === 'approve' ? true : action === 'reject' ? false : activeInterruptEntry.approved,
        reason: extra?.reason || activeInterruptEntry.reason,
        feedback: extra?.feedback || activeInterruptEntry.feedback,
        scope: feedbackScope,
        remember: rememberFeedback,
        respondedAt: new Date().toISOString(),
      };
      setLocalInterruptThread({
        executionId: currentExecution.id,
        entries: (interruptThread.length > 0 ? interruptThread : [activeInterruptEntry]).map((entry) => (
          entry.interruptId === activeInterruptEntry.interruptId ? answeredEntry : entry
        )),
      });
      await resumeExecution(playbookId, {
        executionId: currentExecution.id,
        taskId: interruptPayload?.taskId || interruptedTask?.taskId || '',
        interruptId: interruptPayload?.interruptId || activeInterruptEntry.interruptId,
        action,
        message: extra?.message,
        approved: action === 'approve' ? true : action === 'reject' ? false : undefined,
        reason: extra?.reason,
        feedback: extra?.feedback,
        scope: feedbackScope,
        remember: rememberFeedback,
      });
      setResponse('');
      setRejectReason('');
      setRememberFeedback(false);
      setShowRejectReason(false);
    } catch {
      // handled in store
    } finally {
      setIsSubmittingInterrupt(false);
    }
  }, [playbookId, currentExecution, activeInterruptEntry, interruptPayload?.taskId, interruptPayload?.interruptId, interruptedTask?.taskId, interruptThread, resumeExecution, feedbackScope, rememberFeedback]);

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
    if (isSubmittingInterrupt || !activeInterruptEntry) {
      return;
    }

    void handleInterruptSubmit(
      'reply',
      { message: response || undefined, feedback: response || undefined },
    );
  }, [activeInterruptEntry, handleInterruptSubmit, isSubmittingInterrupt, response]);

  const panelTitle = effectiveCopilotMode === 'interrupt'
    ? getInterruptTitle(activeInterruptEntry?.interruptType ?? interruptPayload?.type ?? 'clarification', t)
    : t('designer.title');
  const pendingInterruptTaskTitle = interruptedTask?.nodeTitle || interruptPayload?.taskTitle || t('copilot.pendingTaskFallback');

  return (
    <div
      className="absolute right-0 inset-y-0 w-80 sm:w-96 z-40 border-l bg-background flex flex-col transition-transform duration-300"
      style={{ transform: designerOpen ? 'translateX(0)' : 'translateX(100%)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{panelTitle}</h3>
          {effectiveCopilotMode === 'interrupt' && (
            <p className="text-xs text-muted-foreground truncate">{pendingInterruptTaskTitle}</p>
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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDesignerOpen(false)}>
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

              return (
                <div key={entry.id} className="space-y-3">
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
                        <span className="text-muted-foreground/60">{formatMessageTime(entry.createdAt)}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{agentText}</p>
                      {entry.taskDescription && (
                        <div className="mt-2 rounded-md border bg-background/70 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            {t('interrupt.taskDescription')}
                          </p>
                          <p className="text-xs whitespace-pre-wrap">{entry.taskDescription}</p>
                        </div>
                      )}
                      {(entry.reasonCode || entry.blockerKind || entry.riskLevel || (entry.downstreamNodeIds?.length ?? 0) > 0) && (
                        <div className="rounded-md border bg-background px-3 py-2 text-xs">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            {t('interrupt.whyPaused')}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {entry.reasonCode && <Badge variant="secondary">{entry.reasonCode}</Badge>}
                            {entry.blockerKind && <Badge variant="outline">{entry.blockerKind}</Badge>}
                            {entry.riskLevel && <Badge variant="outline">{getRiskLabel(String(entry.riskLevel), t)}</Badge>}
                          </div>
                          {(entry.downstreamNodeIds?.length ?? 0) > 0 && (
                            <p className="mt-2 text-muted-foreground">
                              {t('interrupt.downstreamImpact', { count: entry.downstreamNodeIds?.length ?? 0 })}
                            </p>
                          )}
                        </div>
                      )}
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
                          <span>{formatMessageTime(entry.respondedAt)}</span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{responseText}</p>
                        {responseDetail && <p className="text-xs opacity-90 whitespace-pre-wrap">{responseDetail}</p>}
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
      ) : activeInterruptEntry ? (
        <div className="border-t px-3 py-3 shrink-0 space-y-3">
          <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
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
            {activeInterruptEntry.blockerRuleId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                disabled={isDisablingBlocker}
                onClick={() => void handleDisableBlocker()}
              >
                {t('interrupt.disableBlocker')}
              </Button>
            )}
          </div>
          {activeInterruptEntry.interruptType === 'approval_request' ? (
            <>
              <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{t('interrupt.approvalActionHint')}</span>
                  {interruptIterationCount > 1 && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-200">
                      {t('interrupt.iterationContext', { current: interruptIterationIndex + 1, total: interruptIterationCount })}
                    </Badge>
                  )}
                </div>
              </div>
              {showRejectReason && (
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t('interrupt.rejectReasonPlaceholder')}
                  rows={2}
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
                    disabled={isSubmittingInterrupt}
                  >
                  <XCircle className="h-4 w-4 mr-1" />
                  {t('interrupt.reject')}
                </Button>
                <Button
                  size="sm"
                  className="min-w-[180px]"
                  onClick={() => void handleInterruptSubmit('approve')}
                  disabled={isSubmittingInterrupt}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  {t('interrupt.approveAndContinue')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="font-semibold">
                  {activeInterruptEntry.interruptType === 'review_request'
                    ? t('interrupt.reviewActionHint')
                    : t('interrupt.clarificationActionHint')}
                </div>
              </div>
              <Textarea
                ref={interruptComposerRef}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder={t('interrupt.responsePlaceholder')}
                rows={3}
                onKeyDown={handleInterruptResponseKeyDown}
              />
              <div className="flex items-center justify-end gap-2">
                {activeInterruptEntry.interruptType === 'review_request' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleInterruptSubmit('reply', { message: response || undefined, feedback: response || undefined })}
                    disabled={isSubmittingInterrupt || !response.trim()}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    {t('interrupt.submit')}
                  </Button>
                )}
                {activeInterruptEntry.interruptType === 'clarification' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleInterruptSubmit('reply', {
                      message: PROCEED_WITH_AVAILABLE_INFORMATION,
                      feedback: PROCEED_WITH_AVAILABLE_INFORMATION,
                    })}
                    disabled={isSubmittingInterrupt}
                  >
                    {t('interrupt.proceedWithoutMore')}
                  </Button>
                )}
                <Button
                  size="sm"
                  className={activeInterruptEntry.interruptType === 'review_request' ? 'min-w-[180px]' : undefined}
                  onClick={() => void handleInterruptSubmit(
                    activeInterruptEntry.interruptType === 'review_request' ? 'approve' : 'reply',
                    { message: response || undefined, feedback: response || undefined },
                  )}
                  disabled={isSubmittingInterrupt || (activeInterruptEntry.interruptType !== 'review_request' && !response.trim())}
                >
                    {activeInterruptEntry.interruptType === 'review_request' ? (
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
      ) : interruptThread.length > 0 ? (
        <div className="border-t px-3 py-3 shrink-0">
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('interrupt.threadIdleTitle')}
            </div>
            <p className="mt-1">{t('interrupt.threadIdleHint')}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
