import { useEffect, useRef, useState, useCallback, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { X, Send, RotateCcw, AlertCircle, Sparkles, Undo2, CheckCircle2, XCircle, MessageSquare, ShieldCheck, Eye, Square, Info, PanelRightOpen, SlidersHorizontal, ChevronDown, Loader2, Trash2, FolderOpen, Clock, Image as ImageIcon, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { HitlFeedbackScope, HitlHistoryEntry, HumanFeedbackData, IntentSuggestionHistoryEntry, InterruptType, PlaybookIntentClarificationResource, PlaybookIntentConstructionStatus, PlaybookIntentDesignResponse, PlaybookIntentDiagnostic, PlaybookIntentImageInput, PlaybookIntentSuggestion, PlaybookIntentTraceResponse } from '../types';
import { PlaybookClarificationResourcePicker } from './PlaybookClarificationResourcePicker';
import { IntentTraceModal } from './IntentTraceModal';

interface Props {
  playbookId: string | undefined;
  intentDesign?: PlaybookIntentDesignResponse | null;
  intentLoading?: boolean;
  history?: IntentSuggestionHistoryEntry[];
  constructionStatus?: PlaybookIntentConstructionStatus;
  constructionDiagnostics?: PlaybookIntentDiagnostic[];
  intentTraces?: PlaybookIntentTraceResponse | null;
  intentTracesLoading?: boolean;
  onSubmitDesignIntent?: (intentText: string, visibleUserQuery: string, images?: PlaybookIntentImageInput[]) => Promise<void> | void;
  onAnswerDesignIntent?: (answerText?: string) => Promise<void> | void;
  onApplyHistorySuggestion?: (suggestion: PlaybookIntentSuggestion) => void;
  onCancelConstruction?: () => void;
  onReviewConstructionDiagnostic?: (diagnostic: PlaybookIntentDiagnostic) => void;
  assistantPreviewStatus?: 'idle' | 'streaming' | 'ready' | 'applying' | 'discarding';
  onApplyAssistantPreview?: () => void;
  onDiscardAssistantPreview?: () => void;
  onWidthChange?: (width: number) => void;
  onOpenIntentTraces?: () => void;
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
  return formatDateTime(date);
}

function formatDateTime(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function buildIntentTextWithHistory(intentText: string, messages: ReturnType<typeof useDesignMessages>) {
  const normalizedIntent = intentText.trim();
  const history = messages
    .filter((message) => message.status !== 'reverted')
    .flatMap((message) => {
      const timestamp = formatMessageTime(message.createdAt);
      const prefix = timestamp ? `- [${timestamp}] ` : '- ';
      const assistantText = message.status === 'failed'
        ? `Assistant failed: ${normalizeHistoryLine(message.error || message.aiSummary)}`
        : `Assistant: ${normalizeHistoryLine(message.aiSummary)}`;
      return [
        `${prefix}User: ${normalizeHistoryLine(message.userQuery)}`,
        `${prefix}${assistantText}`,
      ];
    })
    .join('\n');

  const currentRequest = `Current user request:\n- [${formatDateTime(new Date())}] User: ${normalizedIntent}`;
  if (!history) return currentRequest;

  return `Previous Designer Assistant chat history:\n${history}\n\n${currentRequest}`;
}

function normalizeHistoryLine(value: string) {
  return value.trim().replace(/\s+/g, ' ');
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

const SIDEBAR_DEFAULT_WIDTH = 576;
const SIDEBAR_MIN_WIDTH = 384;
const SIDEBAR_MAX_WIDTH_RATIO = 0.6;
const MAX_PROMPT_IMAGES = 4;
const MAX_PROMPT_IMAGE_BYTES = 1_500_000;
const SUPPORTED_PROMPT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface PromptImageAttachment extends PlaybookIntentImageInput {
  id: string;
  previewUrl: string;
}

function readPromptImage(file: File): Promise<PromptImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const previewUrl = String(reader.result || '');
      const data = previewUrl.split(',')[1] || '';
      resolve({
        id: `${file.name || 'pasted-image'}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        name: file.name || 'pasted image',
        mediaType: file.type as PlaybookIntentImageInput['mediaType'],
        data,
        previewUrl,
      });
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

export function PlaybookDesignerPanel({
  playbookId,
  intentDesign = null,
  intentLoading = false,
  history = [],
  constructionStatus = 'idle',
  constructionDiagnostics = [],
  intentTraces = null,
  intentTracesLoading = false,
  onSubmitDesignIntent,
  onAnswerDesignIntent,
  onApplyHistorySuggestion,
  onCancelConstruction,
  onReviewConstructionDiagnostic,
  assistantPreviewStatus = 'idle',
  onApplyAssistantPreview,
  onDiscardAssistantPreview,
  onWidthChange,
  onOpenIntentTraces,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const constructionActive = constructionStatus === 'starting' || constructionStatus === 'streaming';

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
  const clearDesignMessages = usePlaybookStore((s) => s.clearDesignMessages);
  const revertToSnapshot = usePlaybookStore((s) => s.revertToSnapshot);
  const resumeExecution = usePlaybookStore((s) => s.resumeExecution);
  const disableHitlBlocker = usePlaybookStore((s) => s.disableHitlBlocker);
  const setDesignerOpen = usePlaybookStore((s) => s.setDesignerOpen);
  const setCopilotMode = usePlaybookStore((s) => s.setCopilotMode);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const stopExecution = usePlaybookStore((s) => s.stopExecution);
  const isStopping = usePlaybookStore((s) => s.isStopping);

  const { saveNow } = useAutosave({ paused: constructionActive });

  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmittingInterrupt, setIsSubmittingInterrupt] = useState(false);
  const [isDisablingBlocker, setIsDisablingBlocker] = useState(false);
  const [feedbackScope, setFeedbackScope] = useState<HitlFeedbackScope>('downstream_run');
  const [rememberFeedback, setRememberFeedback] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [showInterruptOptions, setShowInterruptOptions] = useState(false);
  const [isClearingDesignMemory, setIsClearingDesignMemory] = useState(false);
  const [designStepIndex, setDesignStepIndex] = useState(0);
  const [designAnswers, setDesignAnswers] = useState<Record<string, string>>({});
  const [selectedDesignChoice, setSelectedDesignChoice] = useState('');
  const [selectedDesignResource, setSelectedDesignResource] = useState<PlaybookIntentClarificationResource | null>(null);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [intentTracesModalOpen, setIntentTracesModalOpen] = useState(false);
  const [designAnswer, setDesignAnswer] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [promptImages, setPromptImages] = useState<PromptImageAttachment[]>([]);
  const [promptImageError, setPromptImageError] = useState('');
  const [isMobileOverlay, setIsMobileOverlay] = useState(false);
  const [localInterruptThread, setLocalInterruptThread] = useState<{
    executionId: string;
    entries: InterruptEntry[];
  } | null>(null);
  const [awaitingInterruptReply, setAwaitingInterruptReply] = useState<{
    executionId: string;
    interruptId: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevScrollCount = useRef(0);
  const interruptComposerRef = useRef<HTMLTextAreaElement>(null);
  const designClarificationActionsRef = useRef<HTMLDivElement>(null);

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const resizeDragging = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateMobileOverlay = () => setIsMobileOverlay(mediaQuery.matches);
    updateMobileOverlay();
    mediaQuery.addEventListener('change', updateMobileOverlay);
    return () => mediaQuery.removeEventListener('change', updateMobileOverlay);
  }, []);

  useEffect(() => {
    if (!designerOpen || !isMobileOverlay) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        const designerTrigger = document.querySelector<HTMLElement>('[data-playbook-designer-trigger="true"]');
        const priorFocusIsValid = previouslyFocused?.isConnected
          && previouslyFocused !== document.body
          && !previouslyFocused.matches(':disabled');
        (priorFocusIsValid ? previouslyFocused : designerTrigger)?.focus();
      });
    };
  }, [designerOpen, isMobileOverlay]);

  const handleMobileDialogKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (!isMobileOverlay) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDesignerOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    const focusIsOutside = !panelRef.current?.contains(activeElement);
    if (event.shiftKey && (activeElement === panelRef.current || activeElement === first || focusIsOutside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeElement === panelRef.current || activeElement === last || focusIsOutside)) {
      event.preventDefault();
      first.focus();
    }
  }, [isMobileOverlay, setDesignerOpen]);

  useEffect(() => {
    if (!designerOpen || !isMobileOverlay) return;
    document.addEventListener('keydown', handleMobileDialogKeyDown, true);
    return () => document.removeEventListener('keydown', handleMobileDialogKeyDown, true);
  }, [designerOpen, handleMobileDialogKeyDown, isMobileOverlay]);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    resizeDragging.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [sidebarWidth]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeDragging.current) return;
    const dx = resizeStartX.current - e.clientX;
    const maxWidth = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    setSidebarWidth(Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, resizeStartWidth.current + dx)));
  }, []);

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizeDragging.current) return;
    resizeDragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

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

  const designQuestions = intentDesign?.status === 'needs_clarification' ? intentDesign.questions : [];
  const currentDesignQuestion = designQuestions[Math.min(designStepIndex, Math.max(0, designQuestions.length - 1))] ?? null;
  const isLastDesignQuestion = currentDesignQuestion ? designStepIndex >= designQuestions.length - 1 : true;
  const designIntentBusy = intentLoading;
  const isAwaitingDesignAnswer = effectiveCopilotMode === 'design' && intentDesign?.status === 'needs_clarification' && Boolean(currentDesignQuestion);
  const scrollCount = effectiveCopilotMode === 'design' ? messages.length + (designIntentBusy ? 1 : 0) + designQuestions.length : interruptThread.length;

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
    if (!isAwaitingDesignAnswer) return;
    const frame = window.requestAnimationFrame(() => {
      designClarificationActionsRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [designStepIndex, isAwaitingDesignAnswer]);

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

  useEffect(() => {
    setDesignStepIndex(0);
    setDesignAnswers({});
    setSelectedDesignChoice('');
    setSelectedDesignResource(null);
    setDesignAnswer('');
  }, [intentDesign]);

  const getResourceAnswer = useCallback((resource: PlaybookIntentClarificationResource) => {
    const workspaceName = resource.workspaceName ? `, workspaceName=${resource.workspaceName}` : '';
    const path = resource.path ? `, path=${resource.path}` : '';
    const mimeType = resource.mimeType ? `, mimeType=${resource.mimeType}` : '';
    return `${resource.name} [kind=${resource.kind}, id=${resource.id}, workspaceId=${resource.workspaceId}${workspaceName}${path}${mimeType}]`;
  }, []);

  useEffect(() => {
    onWidthChange?.(designerOpen ? sidebarWidth : 0);
  }, [designerOpen, onWidthChange, sidebarWidth]);

  const getCurrentDesignAnswer = useCallback(() => {
    if (selectedDesignChoice === '__resource__' && selectedDesignResource) return getResourceAnswer(selectedDesignResource);
    if (selectedDesignChoice === '__custom__') return designAnswer.trim();
    return selectedDesignChoice.trim();
  }, [designAnswer, getResourceAnswer, selectedDesignChoice, selectedDesignResource]);

  const getCapturedRequirements = useCallback((includeCurrent: boolean) => {
    const answers = { ...designAnswers };
    if (includeCurrent && currentDesignQuestion) {
      const currentAnswer = getCurrentDesignAnswer();
      if (currentAnswer) answers[currentDesignQuestion.id] = currentAnswer;
    }

    return designQuestions
      .map((question) => {
        const answer = answers[question.id]?.trim();
        return answer ? `${question.question}: ${answer}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }, [currentDesignQuestion, designAnswers, designQuestions, getCurrentDesignAnswer]);

  const loadDesignAnswer = useCallback((questionId: string | undefined, answers: Record<string, string>) => {
    const question = designQuestions.find((item) => item.id === questionId);
    const answer = questionId ? answers[questionId] || '' : '';
    if (!answer) {
      setSelectedDesignChoice('');
      setSelectedDesignResource(null);
      setDesignAnswer('');
      return;
    }
    if (question?.choices?.includes(answer)) {
      setSelectedDesignChoice(answer);
      setSelectedDesignResource(null);
      setDesignAnswer('');
      return;
    }
    setSelectedDesignChoice('__custom__');
    setSelectedDesignResource(null);
    setDesignAnswer(answer);
  }, [designQuestions]);

  const saveCurrentDesignAnswer = useCallback(() => {
    if (!currentDesignQuestion) return '';
    const answer = getCurrentDesignAnswer();
    if (answer) setDesignAnswers((current) => ({ ...current, [currentDesignQuestion.id]: answer }));
    return answer;
  }, [currentDesignQuestion, getCurrentDesignAnswer]);

  const handleBackDesign = useCallback(() => {
    if (designStepIndex <= 0) return;
    const currentAnswer = saveCurrentDesignAnswer();
    const nextAnswers = currentDesignQuestion && currentAnswer
      ? { ...designAnswers, [currentDesignQuestion.id]: currentAnswer }
      : designAnswers;
    const previousQuestion = designQuestions[designStepIndex - 1];
    setDesignAnswers(nextAnswers);
    setDesignStepIndex((current) => Math.max(0, current - 1));
    loadDesignAnswer(previousQuestion?.id, nextAnswers);
  }, [currentDesignQuestion, designAnswers, designQuestions, designStepIndex, loadDesignAnswer, saveCurrentDesignAnswer]);

  const handleContinueDesign = useCallback(() => {
    const currentAnswer = saveCurrentDesignAnswer();
    if (!currentAnswer) return;
    if (!isLastDesignQuestion) {
      const nextQuestion = designQuestions[designStepIndex + 1];
      const nextAnswers = currentDesignQuestion
        ? { ...designAnswers, [currentDesignQuestion.id]: currentAnswer }
        : designAnswers;
      setDesignStepIndex((current) => current + 1);
      setDesignAnswers(nextAnswers);
      loadDesignAnswer(nextQuestion?.id, nextAnswers);
      return;
    }
    void onAnswerDesignIntent?.(getCapturedRequirements(true));
  }, [currentDesignQuestion, designAnswers, designQuestions, designStepIndex, getCapturedRequirements, isLastDesignQuestion, loadDesignAnswer, onAnswerDesignIntent, saveCurrentDesignAnswer]);

  const handleSelectDesignChoice = useCallback((choice: string) => {
    setSelectedDesignChoice(choice);
    if (choice !== '__custom__') setDesignAnswer('');
    if (choice !== '__resource__') setSelectedDesignResource(null);
  }, []);

  const handleSelectDesignResource = useCallback((resource: PlaybookIntentClarificationResource) => {
    setSelectedDesignResource(resource);
    setSelectedDesignChoice('__resource__');
    setDesignAnswer('');
  }, []);

  const handleSkipDesign = useCallback(() => {
    void onAnswerDesignIntent?.(getCapturedRequirements(true));
  }, [getCapturedRequirements, onAnswerDesignIntent]);

  const handleSubmitDesign = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const images = promptImages.map(({ mediaType, data, name }) => ({ mediaType, data, name }));
    if ((!query.trim() && images.length === 0) || !playbookId || designIntentBusy || !onSubmitDesignIntent) return;

    const q = query.trim();
    const imageLabel = `[${images.length} image${images.length === 1 ? '' : 's'} attached]`;
    const visibleQuery = images.length > 0 ? [q, imageLabel].filter(Boolean).join(' ') : q;
    setQuery('');
    setPromptImages([]);
    setPromptImageError('');

    if (isDirty) await saveNow();

    try {
      if (images.length > 0) {
        await onSubmitDesignIntent?.(buildIntentTextWithHistory(visibleQuery, messages), visibleQuery, images);
      } else {
        await onSubmitDesignIntent?.(buildIntentTextWithHistory(visibleQuery, messages), visibleQuery);
      }
    } catch {
      setQuery(q);
      setPromptImages(promptImages);
      return;
    }
    await fetchDesignMessages(playbookId);
  }, [query, promptImages, playbookId, designIntentBusy, isDirty, saveNow, onSubmitDesignIntent, fetchDesignMessages, messages]);

  const handleDesignComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }, []);

  const handleApplyHistory = useCallback((entry: IntentSuggestionHistoryEntry) => {
    if (entry.intent) setQuery(entry.intent);
    onApplyHistorySuggestion?.(entry.suggestion);
    setHistoryOpen(false);
  }, [onApplyHistorySuggestion]);

  const handlePasteDesignImages = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;

    event.preventDefault();
    setPromptImageError('');
    const remainingSlots = MAX_PROMPT_IMAGES - promptImages.length;
    if (remainingSlots <= 0) {
      setPromptImageError(t('designer.images.maxCount', { count: MAX_PROMPT_IMAGES }));
      return;
    }

    const accepted = files.slice(0, remainingSlots).filter((file) => {
      if (!SUPPORTED_PROMPT_IMAGE_TYPES.has(file.type)) {
        setPromptImageError(t('designer.images.unsupported'));
        return false;
      }
      if (file.size > MAX_PROMPT_IMAGE_BYTES) {
        setPromptImageError(t('designer.images.tooLarge'));
        return false;
      }
      return true;
    });
    if (accepted.length < files.length && accepted.length === remainingSlots) {
      setPromptImageError(t('designer.images.maxCount', { count: MAX_PROMPT_IMAGES }));
    }
    if (accepted.length === 0) return;

    void Promise.all(accepted.map(readPromptImage))
      .then((images) => setPromptImages((current) => [...current, ...images].slice(0, MAX_PROMPT_IMAGES)))
      .catch(() => setPromptImageError(t('designer.images.readFailed')));
  }, [promptImages.length, t]);

  const removePromptImage = useCallback((id: string) => {
    setPromptImages((current) => current.filter((image) => image.id !== id));
    setPromptImageError('');
  }, []);

  const handleRevert = useCallback(async (messageId: string) => {
    if (!playbookId) return;
    try {
      await revertToSnapshot(playbookId, messageId);
    } catch {
      // handled in store
    }
  }, [playbookId, revertToSnapshot]);

  const handleClearDesignMemory = useCallback(async () => {
    if (!playbookId || messages.length === 0 || isClearingDesignMemory) return;
    if (!window.confirm(t('designer.clearMemoryConfirm'))) return;

    setIsClearingDesignMemory(true);
    try {
      await clearDesignMessages(playbookId);
    } catch {
      // handled in store
    } finally {
      setIsClearingDesignMemory(false);
    }
  }, [clearDesignMessages, isClearingDesignMemory, messages.length, playbookId, t]);

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
  const canContinueDesign = Boolean(
    selectedDesignChoice
    && (selectedDesignChoice !== '__custom__' || designAnswer.trim().length > 0)
    && (selectedDesignChoice !== '__resource__' || selectedDesignResource)
    && (!isLastDesignQuestion || onAnswerDesignIntent),
  );

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
        ref={panelRef}
        role={isMobileOverlay ? (designerOpen ? 'dialog' : undefined) : 'complementary'}
        aria-modal={isMobileOverlay && designerOpen ? true : undefined}
        aria-hidden={!designerOpen}
        aria-labelledby="playbook-designer-panel-title"
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col border-l bg-background transition-transform duration-300 sm:absolute sm:left-auto sm:z-40"
        style={{ transform: designerOpen ? 'translateX(0)' : 'translateX(100%)', width: sidebarWidth, maxWidth: '100vw' }}
      >
      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="absolute left-0 top-0 bottom-0 z-10 hidden w-1 cursor-ew-resize transition-colors hover:bg-primary/30 active:bg-primary/50 sm:block"
        style={{ touchAction: 'none' }}
      />
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 id="playbook-designer-panel-title" className="text-sm font-semibold">{panelTitle}</h3>
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
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setIntentTracesModalOpen(true);
              onOpenIntentTraces?.();
            }}
            disabled={!onOpenIntentTraces || intentTracesLoading}
            aria-label={t('designer.traces.open')}
            title={t('designer.traces.open')}
          >
            {intentTracesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScrollText className="h-4 w-4" />}
          </Button>
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
                        {formatMessageTime(msg.createdAt)}
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
                              {formatMessageTime(msg.createdAt)}
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

            {designQuestions.map((question) => {
              const answer = designAnswers[question.id];
              if (!answer) return null;
              return (
                <div key={`design-answer-${question.id}`} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    <div className="mb-1 text-[11px] opacity-80">{question.question}</div>
                    <p className="whitespace-pre-wrap">{answer}</p>
                  </div>
                </div>
              );
            })}

            {intentDesign?.status === 'needs_clarification' && currentDesignQuestion ? (
              <div className="flex justify-start">
                <div className="max-w-[92%] space-y-3 rounded-2xl rounded-tl-sm border bg-muted/50 px-3 py-3 text-sm shadow-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>{t('intentBar.design.step', { current: designStepIndex + 1, total: designQuestions.length })}</span>
                    </div>
                    <p className="font-medium">{currentDesignQuestion.question}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(currentDesignQuestion.choices ?? []).map((choice, index) => (
                      <Button
                        key={choice}
                        type="button"
                        variant={selectedDesignChoice === choice ? 'default' : 'outline'}
                        className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                        onClick={() => handleSelectDesignChoice(choice)}
                      >
                        <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">{index + 1}.</span>
                        <span>{choice}</span>
                      </Button>
                    ))}
                    {currentDesignQuestion.resourceSelector ? (
                      <Button
                        type="button"
                        variant={selectedDesignChoice === '__resource__' ? 'default' : 'outline'}
                        className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                        onClick={() => setResourcePickerOpen(true)}
                      >
                        <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">{(currentDesignQuestion.choices?.length ?? 0) + 1}.</span>
                        <FolderOpen className="mr-2 h-4 w-4 shrink-0" />
                        <span>{selectedDesignResource ? selectedDesignResource.name : t(`intentBar.design.resource.${currentDesignQuestion.resourceSelector}`)}</span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant={selectedDesignChoice === '__custom__' ? 'default' : 'outline'}
                      className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                      onClick={() => handleSelectDesignChoice('__custom__')}
                    >
                      <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">{(currentDesignQuestion.choices?.length ?? 0) + (currentDesignQuestion.resourceSelector ? 2 : 1)}.</span>
                      <span>{t('intentBar.design.other')}</span>
                    </Button>
                  </div>
                  {selectedDesignChoice === '__custom__' ? (
                    <Textarea
                      value={designAnswer}
                      onChange={(event) => setDesignAnswer(event.target.value)}
                      placeholder={t('intentBar.design.answerPlaceholder')}
                      rows={2}
                      className="resize-y"
                    />
                  ) : null}
                  <div ref={designClarificationActionsRef} className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={handleBackDesign} disabled={designIntentBusy || designStepIndex === 0}>
                      {t('intentBar.design.back')}
                    </Button>
                    <Button type="button" size="sm" onClick={handleContinueDesign} disabled={designIntentBusy || !canContinueDesign}>
                      {isLastDesignQuestion ? t('intentBar.design.generate') : t('intentBar.design.next')}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={handleSkipDesign} disabled={designIntentBusy || !onAnswerDesignIntent}>
                      {t('intentBar.design.skip')}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {designIntentBusy && intentDesign?.status !== 'needs_clarification' && (
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
        <form
          className={`border-t px-3 py-3 shrink-0 space-y-2 transition-shadow ${isAwaitingDesignAnswer ? 'animate-pulse ring-2 ring-primary/40' : ''}`}
          onSubmit={handleSubmitDesign}
        >
          {constructionDiagnostics.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" aria-label={t('intentBar.diagnostics.title')}>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-medium">{t('intentBar.diagnostics.title')}</p>
                <Badge variant="outline" className="ml-auto text-[10px]">{constructionDiagnostics.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('intentBar.diagnostics.description')}</p>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                {constructionDiagnostics.map((diagnostic) => {
                  const target = diagnostic.reviewTarget;
                  const location = target?.nodeLabel || target?.nodeRef || diagnostic.itemId || t('intentBar.diagnostics.workflow');
                  return (
                    <div key={[diagnostic.stage, diagnostic.code, diagnostic.itemId, diagnostic.path].join(':')} className="rounded-md border bg-background/70 p-2 text-xs">
                      <div className="flex items-start gap-2">
                        <Badge variant={diagnostic.severity === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">
                          {t(`intentBar.diagnostics.severity.${diagnostic.severity}`)}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">
                            {location}{target?.portId ? ` / ${target.portId}` : ''}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {t(`intentBar.diagnostics.resolution.${diagnostic.resolutionCode || 'review_workflow'}`)}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{diagnostic.code}</p>
                        </div>
                        {target?.nodeRef && onReviewConstructionDiagnostic ? (
                          <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onReviewConstructionDiagnostic(diagnostic)}>
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            {t('intentBar.diagnostics.reviewNode')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {assistantPreviewStatus !== 'idle' && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium">{t('intentBar.preview.title')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('intentBar.preview.description')}</p>
              {assistantPreviewStatus === 'ready' && (
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onDiscardAssistantPreview}>
                    {t('intentBar.preview.discard')}
                  </Button>
                  <Button type="button" size="sm" onClick={onApplyAssistantPreview}>
                    {t('intentBar.preview.apply')}
                  </Button>
                </div>
              )}
              {(assistantPreviewStatus === 'applying' || assistantPreviewStatus === 'discarding') && (
                <Loader2 className="mt-2 h-4 w-4 animate-spin" />
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2"
                disabled={messages.length === 0 || messagesLoading || isDesigning || isClearingDesignMemory}
                onClick={() => void handleClearDesignMemory()}
              >
                {isClearingDesignMemory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t('designer.clearMemory')}
              </Button>
              <Button
                type="button"
                variant={historyOpen ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 gap-1.5 px-2"
                disabled={constructionActive || history.length === 0 || !onApplyHistorySuggestion}
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((current) => !current)}
              >
                <Clock className="h-3.5 w-3.5" />
                {t('intentBar.history.title')}
              </Button>
            </div>
          </div>
          {historyOpen ? (
            <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/20 p-2 space-y-1">
              {history.map((entry) => (
                <Button
                  key={entry.id}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal px-2 py-1.5 text-left text-xs"
                  disabled={constructionActive || !onApplyHistorySuggestion}
                  onClick={() => handleApplyHistory(entry)}
                >
                  <span className="line-clamp-2">{entry.intent || entry.suggestion.label}</span>
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleDesignComposerKeyDown}
              onPaste={handlePasteDesignImages}
              placeholder={t('designer.inputPlaceholder')}
              disabled={designIntentBusy && !constructionActive}
              rows={1}
              className="max-h-32 min-h-10 resize-y text-sm"
            />
            <Button
              type={constructionActive ? 'button' : 'submit'}
              size="icon"
              variant={constructionActive ? 'destructive' : 'default'}
              disabled={constructionActive ? !onCancelConstruction : (!query.trim() && promptImages.length === 0) || designIntentBusy || !onSubmitDesignIntent}
              className="shrink-0"
              onClick={constructionActive ? onCancelConstruction : undefined}
              aria-label={constructionActive ? t('intentBar.actions.stop') : t('designer.send')}
            >
              {constructionActive ? <X className="h-4 w-4" /> : designIntentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {promptImages.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {promptImages.map((image) => (
                <div key={image.id} className="group relative h-16 w-16 overflow-hidden rounded-lg border bg-muted">
                  <img src={image.previewUrl} alt={image.name || t('designer.images.attachmentAlt')} className="h-full w-full object-cover" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute right-1 top-1 h-5 w-5 opacity-90"
                    aria-label={t('designer.images.remove')}
                    onClick={() => removePromptImage(image.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              <span>{t('designer.images.pasteHint')}</span>
            </div>
          )}
          {promptImageError ? <p className="text-xs text-destructive">{promptImageError}</p> : null}
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
      {currentDesignQuestion?.resourceSelector ? (
        <PlaybookClarificationResourcePicker
          open={resourcePickerOpen}
          mode={currentDesignQuestion.resourceSelector}
          onOpenChange={setResourcePickerOpen}
          onSelect={handleSelectDesignResource}
        />
      ) : null}
      <IntentTraceModal
        open={intentTracesModalOpen}
        onOpenChange={setIntentTracesModalOpen}
        intentAnalyze={intentTraces?.intentAnalyze ?? []}
        designAssessment={intentTraces?.designAssessment ?? []}
        loading={intentTracesLoading}
      />
    </>
  );
}
