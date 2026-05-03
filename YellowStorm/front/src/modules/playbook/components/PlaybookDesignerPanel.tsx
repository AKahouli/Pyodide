import { useEffect, useRef, useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { X, Send, RotateCcw, AlertCircle, Sparkles, Undo2, CheckCircle2, XCircle, MessageSquare, ShieldCheck, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';
import {
  usePlaybookStore,
  useDesignMessages,
  useDesignMessagesLoading,
  useIsDesigning,
  useDesignerOpen,
  useCopilotMode,
  useCurrentExecution,
  useSelectedStep,
} from '../store';
import { useAutosave } from '../hooks/useAutosave';
import { useIsDirty } from '../store';
import type { HumanFeedbackData, InterruptType } from '../types';

interface Props {
  playbookId: string | undefined;
}

interface InterruptEntry extends HumanFeedbackData {
  id: string;
}

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

export function PlaybookDesignerPanel({ playbookId }: Props) {
  const { t } = useModuleTranslation('playbook');

  const designerOpen = useDesignerOpen();
  const copilotMode = useCopilotMode();
  const messages = useDesignMessages();
  const messagesLoading = useDesignMessagesLoading();
  const isDesigning = useIsDesigning();
  const isDirty = useIsDirty();
  const rawCurrentExecution = useCurrentExecution();
  const currentExecution = rawCurrentExecution?.playbookId === playbookId ? rawCurrentExecution : null;
  const selectedStepId = useSelectedStep();

  const fetchDesignMessages = usePlaybookStore((s) => s.fetchDesignMessages);
  const designPlaybook = usePlaybookStore((s) => s.designPlaybook);
  const revertToSnapshot = usePlaybookStore((s) => s.revertToSnapshot);
  const resumeExecution = usePlaybookStore((s) => s.resumeExecution);
  const setDesignerOpen = usePlaybookStore((s) => s.setDesignerOpen);
  const setCopilotMode = usePlaybookStore((s) => s.setCopilotMode);
  const selectStep = usePlaybookStore((s) => s.selectStep);

  const { saveNow } = useAutosave();

  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmittingInterrupt, setIsSubmittingInterrupt] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollCount = useRef(0);

  const interruptedTask = currentExecution?.taskResults.find(
    (taskResult) => taskResult.taskId === (currentExecution.interruptPayload?.taskId || currentExecution.currentInterruptTaskId || selectedStepId),
  ) || null;

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
      }
    : null);
  const activeInterruptEntry = interruptEntries.find((entry) => entry.status === 'pending')
    || (interruptPayload
      ? {
          id: `${interruptPayload.taskId}-active`,
          interruptType: interruptPayload.type,
          message: interruptPayload.message,
          status: 'pending' as const,
          interruptId: interruptPayload.interruptId || '',
          taskDescription: interruptPayload.taskDescription || '',
          result: interruptPayload.result || '',
        }
      : null);

  const interruptThread = interruptEntries.length > 0
    ? interruptEntries
    : activeInterruptEntry
      ? [activeInterruptEntry]
      : [];

  const scrollCount = copilotMode === 'design' ? messages.length + (isDesigning ? 1 : 0) : interruptThread.length;

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
      await resumeExecution(playbookId, {
        executionId: currentExecution.id,
        taskId: interruptPayload?.taskId || interruptedTask?.taskId || '',
        interruptId: interruptPayload?.interruptId || activeInterruptEntry.interruptId,
        action,
        message: extra?.message,
        approved: action === 'approve' ? true : action === 'reject' ? false : undefined,
        reason: extra?.reason,
        feedback: extra?.feedback,
      });
      setResponse('');
      setRejectReason('');
      setShowRejectReason(false);
    } catch {
      // handled in store
    } finally {
      setIsSubmittingInterrupt(false);
    }
  }, [playbookId, currentExecution, activeInterruptEntry, interruptedTask?.taskId, resumeExecution]);

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

  const panelTitle = copilotMode === 'interrupt'
    ? t('copilot.interruptTitle')
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
          {copilotMode === 'interrupt' && (
            <p className="text-xs text-muted-foreground truncate">{pendingInterruptTaskTitle}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDesignerOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {copilotMode === 'design' ? (
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

            {interruptThread.map((entry) => {
              const isApproval = entry.interruptType === 'approval_request';
              const isReview = entry.interruptType === 'review_request';
              const wasApproved = entry.approved ?? entry.humanResponse === 'approved';
              const agentText = entry.result || entry.message;
              const responseText = getInterruptResponseText(entry, t);
              const responseDetail = getInterruptResponseDetail(entry, responseText);

              return (
                <div key={entry.id} className="space-y-2">
                  <div className="flex justify-start">
                    <div className="max-w-[90%] space-y-2 px-1">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        {isApproval ? (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        ) : isReview ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5" />
                        )}
                        <span>{getInterruptTitle(entry.interruptType, t)}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{agentText}</p>
                      {entry.taskDescription && (
                        <div className="rounded-md border bg-background px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            {t('interrupt.taskDescription')}
                          </p>
                          <p className="text-xs whitespace-pre-wrap">{entry.taskDescription}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {entry.status === 'answered' && (
                    <div className="flex justify-end">
                      <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-sm px-3 py-2 max-w-[85%] space-y-1">
                        <div className="flex items-center gap-1.5 text-xs">
                          {isApproval || isReview ? (
                            wasApproved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />
                          ) : (
                            <MessageSquare className="h-3.5 w-3.5" />
                          )}
                          <span>{responseText}</span>
                        </div>
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

      {copilotMode === 'design' ? (
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
        <div className="border-t px-3 py-3 shrink-0 space-y-2">
          {activeInterruptEntry.interruptType === 'approval_request' ? (
            <>
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
                  onClick={() => void handleInterruptSubmit('approve')}
                  disabled={isSubmittingInterrupt}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  {t('interrupt.approve')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Textarea
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
                <Button
                  size="sm"
                  onClick={() => void handleInterruptSubmit(
                    activeInterruptEntry.interruptType === 'review_request' ? 'approve' : 'reply',
                    { message: response || undefined, feedback: response || undefined },
                  )}
                  disabled={isSubmittingInterrupt || (activeInterruptEntry.interruptType !== 'review_request' && !response.trim())}
                >
                  {activeInterruptEntry.interruptType === 'review_request' ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {t('interrupt.approve')}
                    </>
                  ) : (
                    t('interrupt.submit')
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
