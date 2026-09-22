import * as React from 'react';
import { Activity, ArrowUpRight, Bot, History, Library, ListChecks, MessageSquarePlus, Send, ShieldCheck, Sparkles, Workflow, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ResizablePanel } from '@/components/ui/resizable-panel';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ChatConversation, ChatConversationContent, ChatScrollButton } from '@/components/ai-elements/chat-conversation';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore, usePlaybookUiStore } from '@/modules/playbook';
import { buildChoiceInteractionIndex } from '@/modules/conversation/choice-interactions';
import { getUserMessageDisplayText } from '@/modules/conversation/utils';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';
import type { Message as ConversationMessage, MessageComponent } from '@/modules/conversation/types';
import { ConversationAssistantBubble } from '@/modules/conversation/components/activity/ConversationAssistantBubble';
import { dedupePlatformCopilotUiTargets, executePlatformCopilotUiTarget, findUiTargets, getPlatformCopilotUiTargetIdentity } from './action-bus';
import type { PlatformCopilotPageContext, PlatformCopilotUiTarget } from './types';
import { PlatformCopilotHistoryDialog } from './PlatformCopilotHistoryDialog';
import { usePlatformCopilotConversation } from './usePlatformCopilotConversation';
import { usePlatformCopilotPanelStore } from './platformCopilotPanelStore';

type Message = { id: string; role: 'user' | 'assistant'; text: string; components: MessageComponent[]; isStreaming: boolean; targets?: PlatformCopilotUiTarget[] };

export const PLATFORM_COPILOT_PANEL_WIDTH_STORAGE_KEY = 'ys_platform_copilot_panel_width';
const PLATFORM_COPILOT_PANEL_DEFAULT_WIDTH = 400;
const PLATFORM_COPILOT_PANEL_MIN_WIDTH = 336;
const PLATFORM_COPILOT_PANEL_MAX_WIDTH_RATIO = 0.5;
const PLATFORM_COPILOT_LAUNCHER_MARGIN = 8;

type LauncherPosition = { left: number; top: number };

function clampLauncherPosition(position: LauncherPosition, launcher: HTMLButtonElement): LauncherPosition {
  const rect = launcher.getBoundingClientRect();
  const maxLeft = Math.max(PLATFORM_COPILOT_LAUNCHER_MARGIN, window.innerWidth - rect.width - PLATFORM_COPILOT_LAUNCHER_MARGIN);
  const maxTop = Math.max(PLATFORM_COPILOT_LAUNCHER_MARGIN, window.innerHeight - rect.height - PLATFORM_COPILOT_LAUNCHER_MARGIN);
  return {
    left: Math.max(PLATFORM_COPILOT_LAUNCHER_MARGIN, Math.min(maxLeft, position.left)),
    top: Math.max(PLATFORM_COPILOT_LAUNCHER_MARGIN, Math.min(maxTop, position.top)),
  };
}

function releaseLauncherPointer(launcher: HTMLButtonElement, pointerId: number) {
  if (typeof launcher.hasPointerCapture === 'function' && !launcher.hasPointerCapture(pointerId)) return;
  launcher.releasePointerCapture?.(pointerId);
}

export function PlatformCopilotMascot() {
  const { t, language } = useModuleTranslation('platform-copilot');
  const location = useLocation();
  const navigate = useNavigate();
  const isDirty = usePlaybookStore((state) => state.isDirty);
  const currentPlaybook = usePlaybookStore((state) => state.currentPlaybook);
  const legacyDesignerOpen = usePlaybookStore((state) => state.designerOpen);
  const selectedTaskId = usePlaybookUiStore((state) => state.selectedStepId);
  const designerOpen = usePlaybookUiStore((state) => state.designerOpen);
  const useDrawer = useCompactAssistantLayout();
  const panelOpen = usePlatformCopilotPanelStore((s) => s.open);
  const openPanel = usePlatformCopilotPanelStore((s) => s.openPanel);
  const closePanel = usePlatformCopilotPanelStore((s) => s.closePanel);
  const consumePendingPrompt = usePlatformCopilotPanelStore((s) => s.consumePendingPrompt);
  const pendingHandoff = usePlatformCopilotPanelStore((s) => s.pendingHandoff);
  const clearHandoff = usePlatformCopilotPanelStore((s) => s.clearHandoff);
  const open = panelOpen;
  const [input, setInput] = React.useState('');
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [scrollRequest, setScrollRequest] = React.useState(0);
  const [launcherPosition, setLauncherPosition] = React.useState<LauncherPosition | null>(null);
  const [launcherMovementAnnouncement, setLauncherMovementAnnouncement] = React.useState('');
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const launcherPositionRef = React.useRef<LauncherPosition | null>(null);
  const launcherDragRef = React.useRef<{ pointerId: number; startX: number; startY: number; originLeft: number; originTop: number; moved: boolean } | null>(null);
  const suppressLauncherClickRef = React.useRef(false);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const initializedHandoffIdRef = React.useRef<string>();
  const hasOpenedRef = React.useRef(false);
  const previousDesignerOpenRef = React.useRef(designerOpen);
  const [, refreshExpiry] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    if (!open) return;
    if (pendingHandoff) {
      if (initializedHandoffIdRef.current !== pendingHandoff.handoffId) {
        initializedHandoffIdRef.current = pendingHandoff.handoffId;
        setInput(pendingHandoff.suggestedPrompt);
      }
      return;
    }
    initializedHandoffIdRef.current = undefined;
    const pendingPrompt = consumePendingPrompt();
    if (pendingPrompt) setInput(pendingPrompt);
  }, [consumePendingPrompt, open, pendingHandoff]);

  React.useEffect(() => {
    if (open || !hasOpenedRef.current) return;
    const frame = window.requestAnimationFrame(() => launcherRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (designerOpen && !previousDesignerOpenRef.current && open) closePanel();
    previousDesignerOpenRef.current = designerOpen;
  }, [designerOpen, open, closePanel]);

  React.useEffect(() => {
    if (!open || useDrawer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, useDrawer, closePanel]);

  React.useEffect(() => {
    if (!pendingHandoff) return;
    const delay = new Date(pendingHandoff.expiresAt).getTime() - Date.now();
    if (delay <= 0) return;
    const timeout = window.setTimeout(refreshExpiry, delay);
    return () => window.clearTimeout(timeout);
  }, [pendingHandoff]);

  React.useEffect(() => {
    const keepLauncherInViewport = () => {
      setLauncherPosition((position) => {
        if (!position || !launcherRef.current) return position;
        const clamped = clampLauncherPosition(position, launcherRef.current);
        launcherPositionRef.current = clamped;
        return clamped;
      });
    };
    window.addEventListener('resize', keepLauncherInViewport);
    return () => window.removeEventListener('resize', keepLauncherInViewport);
  }, []);

  React.useLayoutEffect(() => {
    if (open || !launcherRef.current) return;
    setLauncherPosition((position) => {
      if (!position || !launcherRef.current) return position;
      const clamped = clampLauncherPosition(position, launcherRef.current);
      launcherPositionRef.current = clamped;
      return clamped;
    });
  }, [open]);

  const pageContext = React.useMemo<PlatformCopilotPageContext>(() => {
    const match = location.pathname.match(/^\/playbooks\/([^/]+)(?:\/executions\/([^/]+))?/);
    const playbookId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    const executionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
    const isExecutionRoute = /^\/playbooks\/[^/]+\/executions(?:\/|$)/.test(location.pathname);
    return {
      route: `${location.pathname}${location.search}`,
      module: isExecutionRoute ? 'executions' : playbookId || location.pathname === '/playbooks' ? 'playbooks' : 'other',
      surface: isExecutionRoute ? 'playbook.execution.details' : playbookId ? 'playbook.editor' : location.pathname === '/playbooks' ? 'playbook.list' : 'other',
      ...(executionId ? { entity: { type: 'execution' as const, id: executionId } } : playbookId ? { entity: { type: 'playbook' as const, id: playbookId } } : {}),
      ...(selectedTaskId && playbookId ? { selection: { type: 'task' as const, id: selectedTaskId } } : {}),
      availableActions: playbookId ? ['explain', 'validate', 'open', 'run'] : ['search', 'open'],
      hasUnsavedChanges: Boolean(playbookId && isDirty),
      locale: language,
      contextVersion: 1,
    };
  }, [isDirty, language, location.pathname, location.search, selectedTaskId]);

  const routePlaybookId = pageContext.entity?.type === 'playbook' ? pageContext.entity.id : undefined;
  const platformCopilot = usePlatformCopilotConversation(open, pageContext, pendingHandoff);
  React.useEffect(() => {
    if (platformCopilot.error) handleApiError(platformCopilot.error);
  }, [platformCopilot.error]);
  const persistedMessages = React.useMemo(() => platformCopilot.messages
    .map((message) => toDisplayMessage(message))
    .filter((message): message is Message => message !== null), [platformCopilot.messages]);
  const messages = React.useMemo(() => {
    if (!platformCopilot.streamingMessageId) return persistedMessages;
    const persisted = platformCopilot.messages.find((message) => message.id === platformCopilot.streamingMessageId);
    const streaming = toDisplayMessage({
      ...(persisted ?? {
        id: platformCopilot.streamingMessageId,
        conversationId: platformCopilot.conversationId ?? '',
        conversationType: 'ai' as const,
        webSearchEnabled: false,
        isComplete: false,
        createdAt: new Date().toISOString(),
      }),
      components: platformCopilot.streamingComponents,
      isStreaming: true,
    }, true);
    if (!streaming) return persistedMessages;
    const index = persistedMessages.findIndex((message) => message.id === streaming.id);
    if (index < 0) return [...persistedMessages, streaming];
    const next = [...persistedMessages];
    next[index] = streaming;
    return next;
  }, [persistedMessages, platformCopilot.conversationId, platformCopilot.messages, platformCopilot.streamingComponents, platformCopilot.streamingMessageId]);
  const loading = platformCopilot.loading || Boolean(platformCopilot.streamingMessageId);
  const handoffExpired = Boolean(pendingHandoff && new Date(pendingHandoff.expiresAt).getTime() <= Date.now());

  const handleLauncherPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    launcherDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleLauncherPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaX) <= 4 && Math.abs(deltaY) <= 4) return;
    drag.moved = true;
    event.preventDefault();
    const position = clampLauncherPosition({ left: drag.originLeft + deltaX, top: drag.originTop + deltaY }, event.currentTarget);
    launcherPositionRef.current = position;
    setLauncherPosition(position);
  };

  const handleLauncherPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const handleTouchTap = event.pointerType === 'touch' && !drag.moved;
    suppressLauncherClickRef.current = drag.moved || handleTouchTap;
    if (suppressLauncherClickRef.current) {
      window.setTimeout(() => { suppressLauncherClickRef.current = false; }, 0);
    }
    if (drag.moved && launcherPositionRef.current) {
      setLauncherMovementAnnouncement(t('launcher.position', {
        x: Math.round(launcherPositionRef.current.left),
        y: Math.round(launcherPositionRef.current.top),
      }));
    }
    launcherDragRef.current = null;
    releaseLauncherPointer(event.currentTarget, event.pointerId);
    if (handleTouchTap) {
      hasOpenedRef.current = true;
      openPanel();
    }
  };

  const handleLauncherPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (launcherDragRef.current?.pointerId !== event.pointerId) return;
    launcherDragRef.current = null;
    releaseLauncherPointer(event.currentTarget, event.pointerId);
  };

  const handleLauncherLostPointerCapture = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (launcherDragRef.current?.pointerId === event.pointerId) launcherDragRef.current = null;
  };

  const handleLauncherKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === 'ArrowLeft') deltaX = -10;
    else if (event.key === 'ArrowRight') deltaX = 10;
    else if (event.key === 'ArrowUp') deltaY = -10;
    else if (event.key === 'ArrowDown') deltaY = 10;
    else return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = clampLauncherPosition({ left: rect.left + deltaX, top: rect.top + deltaY }, event.currentTarget);
    launcherPositionRef.current = position;
    setLauncherPosition(position);
    setLauncherMovementAnnouncement(t('launcher.position', { x: Math.round(position.left), y: Math.round(position.top) }));
  };

  const sendMessage = async () => {
    const message = (composerRef.current?.value ?? input).trim();
    const expired = Boolean(pendingHandoff && new Date(pendingHandoff.expiresAt).getTime() <= Date.now());
    if (!message || loading || expired) return;
    setScrollRequest((request) => request + 1);
    if (await platformCopilot.send(message, undefined, undefined, pendingHandoff ?? undefined)) {
      setInput('');
      clearHandoff();
    }
  };

  const choiceInteractions = React.useMemo(
    () => buildChoiceInteractionIndex(platformCopilot.messages),
    [platformCopilot.messages],
  );

  const handleChoiceAction = React.useCallback(async (sourceMessageId: string, action: ChoiceComponentAction) => {
    if (!platformCopilot.conversationId) throw new Error('No active conversation');
    const ok = await platformCopilot.send(action.submitText, {
      ...action.interaction,
      sourceMessageId,
    });
    if (!ok) throw new Error('Failed to submit the answer');
  }, [platformCopilot.conversationId, platformCopilot.send]);

  const handleSubmitQuestions = React.useCallback((sourceMessageId: string) => async (actions: ChoiceComponentAction[]) => {
    if (!platformCopilot.conversationId) throw new Error('No active conversation');
    const ok = await platformCopilot.send(
      actions.map((action) => action.submitText).join(' '),
      undefined,
      actions.map((action) => ({ ...action.interaction, sourceMessageId })),
    );
    if (!ok) throw new Error('Failed to submit the answers');
  }, [platformCopilot.conversationId, platformCopilot.send]);

  const contextPlaybook = currentPlaybook?.id === routePlaybookId ? currentPlaybook : null;
  const selectedTask = contextPlaybook?.tasks.find((task) => task.id === selectedTaskId)
    ?? contextPlaybook?.nodes?.find((node) => node.id === selectedTaskId);

  const autoConsumedHandoffsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!open || !routePlaybookId || pageContext.surface !== 'playbook.editor') return;
    for (const target of messages.flatMap((message) => message.targets ?? [])) {
      if (!target.params.operationId) continue;
      if (!shouldAutoConsumeCanvasHandoff(target, routePlaybookId, Boolean(pageContext.hasUnsavedChanges))) continue;
      const identity = getPlatformCopilotUiTargetIdentity(target);
      if (autoConsumedHandoffsRef.current.has(identity)) continue;
      autoConsumedHandoffsRef.current.add(identity);
      // The impacted canvas is already open: consume the operation in place instead of showing a button.
      executePlatformCopilotUiTarget({ target, pageContext, navigate, confirmNavigation: () => window.confirm(t('navigation.unsaved')) });
    }
  }, [messages, open, pageContext, routePlaybookId, navigate, t]);

  const autoConsumedExecutionHandoffsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!open || !routePlaybookId || pageContext.surface !== 'playbook.editor') return;
    let cancelled = false;
    for (const target of messages.flatMap((message) => message.targets ?? [])) {
      if (!shouldAutoConsumeExecutionHandoff(target, routePlaybookId)) continue;
      const identity = getPlatformCopilotUiTargetIdentity(target);
      if (autoConsumedExecutionHandoffsRef.current.has(identity)) continue;
      autoConsumedExecutionHandoffsRef.current.add(identity);

      const { playbookId, executionId } = target.params;
      if (!playbookId || !executionId) continue;
      const playbookStore = usePlaybookStore.getState();
      playbookStore.setPageMode('run');
      playbookStore.setExecutionPanelOpen(true);
      void (async () => {
        await playbookStore.fetchExecutions(playbookId);
        if (cancelled) return;
        await playbookStore.fetchExecution(playbookId, executionId);
        if (cancelled) return;
        playbookStore.viewExecutionInPanel(executionId);
      })();
    }
    return () => { cancelled = true; };
  }, [messages, open, pageContext.surface, routePlaybookId]);

  const renderAction = (target: PlatformCopilotUiTarget) => {
    const presentation = getTargetPresentation(target.surface);
    const Icon = presentation.icon;
    return (
      <Button
        type='button'
        key={getPlatformCopilotUiTargetIdentity(target)}
        variant='ghost'
        className='group/action h-auto min-h-11 w-full justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left shadow-sm hover:border-primary/40 hover:bg-accent'
        onClick={() => executePlatformCopilotUiTarget({ target, pageContext, navigate, confirmNavigation: () => window.confirm(t('navigation.unsaved')) })}>
        <span className='flex min-w-0 items-center gap-3'>
          <span className='grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground group-hover/action:text-foreground'><Icon className='size-4' /></span>
          <span className='min-w-0'>
            <span className='block truncate text-sm font-medium'>{t(presentation.labelKey)}</span>
            <span className='block truncate text-xs font-normal text-muted-foreground'>{t(presentation.descriptionKey)}</span>
          </span>
        </span>
        <ArrowUpRight className='size-4 shrink-0 text-muted-foreground group-hover/action:text-foreground' />
      </Button>
    );
  };

  const panel = (
    <>
      <header className='min-w-0 shrink-0 border-b bg-card px-4 py-4'>
        <div className={`flex items-start gap-3 ${useDrawer ? 'pr-10' : ''}`}>
          <div className='grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm'><Bot className='size-5' /></div>
          <div className='min-w-0 flex-1'>
            <h2 className='text-base font-semibold leading-5'>{t('title')}</h2>
            <p className='mt-0.5 text-xs text-muted-foreground'>{t('description')}</p>
          </div>
          <div className='ml-auto flex shrink-0 items-center gap-1'>
            <Button type='button' variant='ghost' size='icon' className='size-9' title={t('newConversation')} aria-label={t('newConversation')} disabled={loading || Boolean(pendingHandoff)} onClick={() => { void platformCopilot.createNewConversation().then((created) => { if (created) { setInput(''); setScrollRequest((request) => request + 1); } }); }}>
              <MessageSquarePlus className='size-4' />
            </Button>
            <Button type='button' variant='ghost' size='icon' className='size-9' title={t('history.open')} aria-label={t('history.open')} disabled={loading || Boolean(pendingHandoff)} onClick={() => { setHistoryOpen(true); void platformCopilot.refreshHistory(); }}>
              <History className='size-4' />
            </Button>
            {!useDrawer && <Button type='button' variant='ghost' size='icon' className='size-9' aria-label={t('close')} onClick={closePanel}>
              <X className='size-4' />
            </Button>}
          </div>
        </div>
        <div className='mt-3 flex min-w-0 items-center gap-2 rounded-lg border bg-muted/45 px-3 py-2'>
          <Workflow className='size-4 shrink-0 text-primary' />
          <div className='min-w-0'>
            <p className='truncate text-xs font-medium'>{contextPlaybook?.name ?? t(getContextLabelKey(pageContext))}</p>
            {selectedTask && <p className='truncate text-[11px] text-muted-foreground'>{t('context.selectedTask', { name: 'title' in selectedTask ? selectedTask.title : selectedTask.label })}</p>}
          </div>
          <Badge variant='outline' className='ml-auto shrink-0 text-[10px]'>{t('context.live')}</Badge>
        </div>
      </header>
      <ChatConversation className='min-h-0 min-w-0 flex-1'>
        <FollowConversation request={scrollRequest} />
        <ChatConversationContent className='min-w-0 space-y-5 px-4 py-5' aria-live='polite'>
          {messages.length === 0 && (
            <div className='rounded-xl border border-dashed bg-muted/25 p-4'>
              <Sparkles className='size-5 text-primary' />
              <p className='mt-3 text-sm font-medium'>{t('empty.title')}</p>
              <p className='mt-1 text-xs leading-5 text-muted-foreground'>{t('empty.description')}</p>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`min-w-0 max-w-full ${message.role === 'user' ? 'ml-8' : 'w-full'}`}>
              <div className='mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground'>
                {message.role === 'assistant' && <Bot className='size-3.5' />}
                {message.role === 'user' ? t('you') : t('assistant')}
              </div>
              <div className={message.role === 'user'
                ? 'rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm'
                : 'min-w-0 max-w-full overflow-hidden text-sm leading-6 text-foreground'}>
                {message.role === 'assistant' ? (
                  <MessageProvider isStreaming={message.isStreaming} isLastAiMessage>
                    <ConversationAssistantBubble
                      conversationId={platformCopilot.conversationId ?? ''}
                      messageId={message.id}
                      components={message.components}
                      isStreaming={message.isStreaming}
                      showWorking={message.isStreaming && message.components.length === 0}
                      restrictActivityDetails
                      choiceInteractions={choiceInteractions}
                      onComponentAction={(action) => handleChoiceAction(message.id, action)}
                      onSubmitQuestions={handleSubmitQuestions(message.id)}
                    />
                  </MessageProvider>
                ) : <p className='whitespace-pre-wrap break-words'>{message.text}</p>}
              </div>
              {(() => {
                const visibleTargets = (message.targets ?? []).filter(
                  (target) => pageContext.surface !== 'playbook.editor'
                    || !shouldAutoConsumeCanvasHandoff(target, routePlaybookId, Boolean(pageContext.hasUnsavedChanges)),
                );
                return visibleTargets.length > 0 ? (
                  <div className='mt-3 space-y-2'>
                    <p className='text-[11px] font-medium text-muted-foreground'>{t('navigation.related')}</p>
                    {visibleTargets.map(renderAction)}
                  </div>
                ) : null;
              })()}
            </article>
          ))}
        </ChatConversationContent>
        <ChatScrollButton className='bottom-3 z-10' aria-label={t('scrollLatest')} title={t('scrollLatest')} />
      </ChatConversation>
      <footer className='shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
        {pendingHandoff && (
          <section className='mb-3 rounded-xl border bg-muted/30 p-3' aria-label={t('handoff.previewLabel')}>
            <div className='flex items-start gap-2'>
              <Workflow className='mt-0.5 size-4 shrink-0 text-primary' />
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium'>{t('handoff.title')}</p>
                <p className='mt-0.5 text-xs text-muted-foreground'>{t('handoff.description')}</p>
              </div>
              <Button type='button' variant='ghost' size='sm' onClick={() => { clearHandoff(); setInput(''); }}>{t('handoff.discard')}</Button>
            </div>
            {pendingHandoff.preview.goal && <p className='mt-3 text-xs leading-5'><span className='font-medium'>{t('handoff.goal')}</span> {pendingHandoff.preview.goal}</p>}
            {pendingHandoff.preview.planSteps.length > 0 && (
              <div className='mt-2'>
                <p className='text-xs font-medium'>{t('handoff.steps')}</p>
                <ul className='mt-1 space-y-1 text-xs text-muted-foreground'>
                  {pendingHandoff.preview.planSteps.slice(0, 5).map((step, index) => <li key={`${step.label}-${index}`}>{step.label}</li>)}
                </ul>
              </div>
            )}
            {pendingHandoff.preview.actions.length > 0 && <p className='mt-2 text-xs text-muted-foreground'>{t('handoff.actions', { actions: pendingHandoff.preview.actions.slice(0, 5).map((action) => action.label || action.name).join(', ') })}</p>}
            {pendingHandoff.preview.resources.length > 0 && <p className='mt-1 text-xs text-muted-foreground'>{t('handoff.resources', { resources: pendingHandoff.preview.resources.slice(0, 5).map((resource) => resource.label).join(', ') })}</p>}
            <p className='mt-2 text-[11px] text-muted-foreground' aria-live='polite'>
              {handoffExpired ? t('handoff.expired') : t('handoff.expires', { date: new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(pendingHandoff.expiresAt)) })}
            </p>
          </section>
        )}
        <label htmlFor='platform-copilot-message' className='sr-only'>{t('placeholder')}</label>
        <div className='flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring'>
          <Textarea ref={composerRef} id='platform-copilot-message' name='platformCopilotMessage' value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('placeholder')} className='max-h-32 min-h-10 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0' onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
          <Button type='button' size='icon' className='size-11 shrink-0 rounded-lg' onClick={(event) => { event.preventDefault(); event.stopPropagation(); void sendMessage(); }} disabled={loading || handoffExpired || !input.trim()} aria-label={t('sendLabel')}><Send className='size-4' /></Button>
        </div>
      </footer>
    </>
  );

  if (routePlaybookId && (designerOpen || legacyDesignerOpen)) return null;

  return (
    <>
      {!open && (
        <Button ref={launcherRef} type='button' style={launcherPosition ? { ...launcherPosition, right: 'auto', bottom: 'auto' } : undefined} className='pointer-events-auto fixed bottom-5 right-5 z-[120] h-14 cursor-grab touch-none select-none rounded-full border border-primary-foreground/20 px-5 shadow-xl shadow-primary/20 active:cursor-grabbing' aria-label={t('open')} aria-describedby='platform-copilot-launcher-instructions' onPointerDown={handleLauncherPointerDown} onPointerMove={handleLauncherPointerMove} onPointerUp={handleLauncherPointerUp} onPointerCancel={handleLauncherPointerCancel} onLostPointerCapture={handleLauncherLostPointerCapture} onKeyDown={handleLauncherKeyDown} onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (suppressLauncherClickRef.current) {
            suppressLauncherClickRef.current = false;
            return;
          }
          hasOpenedRef.current = true;
          openPanel();
        }}>
          <Sparkles className='mr-2 h-5 w-5' />
          {t('title')}
        </Button>
      )}
      <span id='platform-copilot-launcher-instructions' className='sr-only'>{t('launcher.moveInstructions')}</span>
      <span className='sr-only' aria-live='polite'>{launcherMovementAnnouncement}</span>
      {open && useDrawer && (
        <Sheet open onOpenChange={(nextOpen) => { if (nextOpen) openPanel(); else closePanel(); }}>
          <SheetContent className='pointer-events-auto z-40 flex w-full flex-col gap-0 p-0 [&>button]:right-3 [&>button]:top-3 [&>button]:grid [&>button]:size-11 [&>button]:place-items-center [&>button_svg]:size-5 sm:max-w-md' overlayClassName='z-40' aria-label={t('title')} closeLabel={t('close')}>
            <SheetHeader className='sr-only'><SheetTitle>{t('title')}</SheetTitle><SheetDescription>{t('description')}</SheetDescription></SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      )}
      {open && !useDrawer && (
        <ResizablePanel
          storageKey={PLATFORM_COPILOT_PANEL_WIDTH_STORAGE_KEY}
          defaultWidth={PLATFORM_COPILOT_PANEL_DEFAULT_WIDTH}
          minWidth={PLATFORM_COPILOT_PANEL_MIN_WIDTH}
          maxWidthRatio={PLATFORM_COPILOT_PANEL_MAX_WIDTH_RATIO}
          handlePosition='left'
          withHandle
          resizeHandleLabel={t('resize')}
          className='z-40 h-svh border-l bg-background shadow-[-8px_0_24px_-20px_hsl(var(--foreground))]'
        >
          <aside className='flex h-full min-w-0 flex-1 flex-col' aria-label={t('title')}>
            {panel}
          </aside>
        </ResizablePanel>
      )}
      <PlatformCopilotHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        conversations={platformCopilot.history}
        activeConversationId={platformCopilot.conversationId}
        loading={platformCopilot.historyLoading || platformCopilot.loading}
        onSelect={platformCopilot.selectConversation}
      />
    </>
  );
}

function FollowConversation({ request }: Readonly<{ request: number }>) {
  const { scrollToBottom } = useStickToBottomContext();
  React.useEffect(() => {
    if (request > 0) void scrollToBottom();
  }, [request, scrollToBottom]);
  return null;
}

function useCompactAssistantLayout(): boolean {
  const [compact, setCompact] = React.useState(() => window.innerWidth < 1024);
  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

function getContextLabelKey(pageContext: PlatformCopilotPageContext): 'context.execution' | 'context.playbook' | 'context.library' | 'context.platform' {
  if (pageContext.entity?.type === 'execution') return 'context.execution';
  if (pageContext.entity?.type === 'playbook') return 'context.playbook';
  if (pageContext.module === 'playbooks') return 'context.library';
  return 'context.platform';
}

function getTargetPresentation(surface: PlatformCopilotUiTarget['surface']) {
  const presentations = {
    'playbook.list': { icon: Library, labelKey: 'navigation.playbooks', descriptionKey: 'navigation.playbooksDescription' },
    'playbook.editor': { icon: Workflow, labelKey: 'navigation.canvas', descriptionKey: 'navigation.canvasDescription' },
    'playbook.editor.assistant': { icon: Sparkles, labelKey: 'navigation.canvasAssistant', descriptionKey: 'navigation.canvasAssistantDescription' },
    'playbook.validation': { icon: ShieldCheck, labelKey: 'navigation.validation', descriptionKey: 'navigation.validationDescription' },
    'playbook.execution.details': { icon: Activity, labelKey: 'navigation.execution', descriptionKey: 'navigation.executionDescription' },
    'playbook.execution.task': { icon: ListChecks, labelKey: 'navigation.executionTask', descriptionKey: 'navigation.executionTaskDescription' },
  } as const;
  return presentations[surface];
}

// Canvas handoff buttons are only useful when the impacted Playbook canvas is not already open.
const CANVAS_TARGET_SURFACES: ReadonlySet<PlatformCopilotUiTarget['surface']> = new Set(['playbook.editor', 'playbook.editor.assistant']);

export function shouldAutoConsumeCanvasHandoff(
  target: PlatformCopilotUiTarget,
  routePlaybookId: string | undefined,
  canvasDirty: boolean,
): boolean {
  return !canvasDirty && CANVAS_TARGET_SURFACES.has(target.surface)
    && Boolean(routePlaybookId) && target.params.playbookId === routePlaybookId;
}

export function shouldAutoConsumeExecutionHandoff(
  target: PlatformCopilotUiTarget,
  routePlaybookId: string | undefined,
): boolean {
  return target.surface === 'playbook.execution.details'
    && target.params.playbookId === routePlaybookId
    && Boolean(target.params.executionId)
    && target.effects?.some((effect) => effect.type === 'focusExecutionStatus') === true;
}

function toDisplayMessage(message: ConversationMessage, isStreaming = false): Message | null {
  const components = message.components ?? [];
  const displayMessage: Message = {
    id: message.id,
    role: message.conversationType === 'user' ? 'user' : 'assistant',
    text: message.conversationType === 'user' ? getUserMessageDisplayText(message) : '',
    components,
    isStreaming,
    targets: dedupePlatformCopilotUiTargets(components.flatMap((component) => findUiTargets(getToolResult(component)))),
  };
  if (displayMessage.role === 'assistant'
    && !displayMessage.text
    && !displayMessage.targets?.length
    && !isStreaming
    && components.length === 0) {
    return null;
  }
  return displayMessage;
}

function getToolResult(component: MessageComponent): unknown {
  if (component.type !== 'toolActivity') return undefined;
  return component.data.resultJson;
}
