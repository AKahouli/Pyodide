import * as React from 'react';
import { Activity, ArrowUpRight, Bot, History, Library, ListChecks, MessageSquarePlus, Send, ShieldCheck, Sparkles, Workflow, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Streamdown } from 'streamdown';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ResizablePanel } from '@/components/ui/resizable-panel';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ChatConversation, ChatConversationContent, ChatScrollButton } from '@/components/ai-elements/chat-conversation';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore, usePlaybookUiStore } from '@/modules/playbook';
import type { Message as ConversationMessage, MessageComponent } from '@/modules/conversation/types';
import { dedupeSecondBrainUiTargets, executeSecondBrainUiTarget, findUiTargets, getSecondBrainUiTargetIdentity } from './action-bus';
import type { SecondBrainPageContext, SecondBrainUiTarget } from './types';
import { SecondBrainActivity } from './SecondBrainActivity';
import { SecondBrainHistoryDialog } from './SecondBrainHistoryDialog';
import { useSecondBrainConversation } from './useSecondBrainConversation';

type Message = { id: string; role: 'user' | 'assistant'; text: string; components: MessageComponent[]; isStreaming: boolean; targets?: SecondBrainUiTarget[] };

export const SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY = 'ys_second_brain_panel_width';
const SECOND_BRAIN_PANEL_DEFAULT_WIDTH = 400;
const SECOND_BRAIN_PANEL_MIN_WIDTH = 336;
const SECOND_BRAIN_PANEL_MAX_WIDTH_RATIO = 0.5;

export function shouldShowSecondBrainMascot(
  isPlaybookRoute: boolean,
  pageMode: 'design' | 'run',
  executionStatus: string | undefined,
): boolean {
  if (!isPlaybookRoute) return true;
  return pageMode !== 'run' && !['queued', 'running'].includes(executionStatus ?? '');
}

export function SecondBrainMascot() {
  const { t, language } = useModuleTranslation('second-brain');
  const location = useLocation();
  const navigate = useNavigate();
  const isDirty = usePlaybookStore((state) => state.isDirty);
  const currentPlaybook = usePlaybookStore((state) => state.currentPlaybook);
  const currentExecution = usePlaybookStore((state) => state.currentExecution);
  const selectedTaskId = usePlaybookUiStore((state) => state.selectedStepId);
  const designerOpen = usePlaybookUiStore((state) => state.designerOpen);
  const setDesignerOpen = usePlaybookUiStore((state) => state.setDesignerOpen);
  const pageMode = usePlaybookUiStore((state) => state.pageMode);
  const useDrawer = useCompactAssistantLayout();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [scrollRequest, setScrollRequest] = React.useState(0);
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const hasOpenedRef = React.useRef(false);
  const previousDesignerOpenRef = React.useRef(designerOpen);

  React.useEffect(() => {
    if (open || !hasOpenedRef.current) return;
    const frame = window.requestAnimationFrame(() => launcherRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (designerOpen && !previousDesignerOpenRef.current && open) setOpen(false);
    previousDesignerOpenRef.current = designerOpen;
  }, [designerOpen, open]);

  React.useEffect(() => {
    if (!open || useDrawer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, useDrawer]);

  const pageContext = React.useMemo<SecondBrainPageContext>(() => {
    const match = location.pathname.match(/^\/playbooks\/([^/]+)(?:\/executions\/([^/]+))?/);
    const playbookId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    const executionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
    return {
      route: `${location.pathname}${location.search}`,
      module: executionId ? 'executions' : playbookId || location.pathname === '/playbooks' ? 'playbooks' : 'other',
      surface: executionId ? 'playbook.execution.details' : playbookId ? 'playbook.editor' : location.pathname === '/playbooks' ? 'playbook.list' : 'other',
      ...(executionId ? { entity: { type: 'execution' as const, id: executionId } } : playbookId ? { entity: { type: 'playbook' as const, id: playbookId } } : {}),
      ...(selectedTaskId && playbookId ? { selection: { type: 'task' as const, id: selectedTaskId } } : {}),
      availableActions: playbookId ? ['explain', 'validate', 'open', 'run'] : ['search', 'open'],
      hasUnsavedChanges: Boolean(playbookId && isDirty),
      locale: language,
      contextVersion: 1,
    };
  }, [isDirty, language, location.pathname, location.search, selectedTaskId]);

  const secondBrain = useSecondBrainConversation(open, pageContext);
  React.useEffect(() => {
    if (secondBrain.error) handleApiError(secondBrain.error);
  }, [secondBrain.error]);
  const messages = React.useMemo(() => {
    const persisted = secondBrain.messages
      .map((message) => {
        const isStreaming = message.id === secondBrain.streamingMessageId;
        return toDisplayMessage({
          ...message,
          components: isStreaming ? secondBrain.streamingComponents : message.components,
        }, isStreaming);
      })
      .filter((message): message is Message => message !== null);
    if (!secondBrain.streamingMessageId || persisted.some((message) => message.id === secondBrain.streamingMessageId)) return persisted;
    const streaming = toDisplayMessage({
      id: secondBrain.streamingMessageId,
      conversationId: secondBrain.conversationId ?? '',
      conversationType: 'ai',
      components: secondBrain.streamingComponents,
      webSearchEnabled: false,
      isStreaming: true,
      isComplete: false,
      createdAt: new Date().toISOString(),
    }, true);
    return streaming ? [...persisted, streaming] : persisted;
  }, [secondBrain.conversationId, secondBrain.messages, secondBrain.streamingComponents, secondBrain.streamingMessageId]);
  const loading = secondBrain.loading || Boolean(secondBrain.streamingMessageId);

  const sendMessage = async () => {
    const message = input.trim();
    if (!message || loading) return;
    setScrollRequest((request) => request + 1);
    if (await secondBrain.send(message)) setInput('');
  };

  const routePlaybookId = pageContext.entity?.type === 'playbook' ? pageContext.entity.id : undefined;
  const contextPlaybook = currentPlaybook?.id === routePlaybookId ? currentPlaybook : null;
  const showMascot = shouldShowSecondBrainMascot(
    Boolean(routePlaybookId),
    pageMode,
    currentExecution?.playbookId === routePlaybookId ? currentExecution?.status : undefined,
  );
  const selectedTask = contextPlaybook?.tasks.find((task) => task.id === selectedTaskId)
    ?? contextPlaybook?.nodes?.find((node) => node.id === selectedTaskId);

  const renderAction = (target: SecondBrainUiTarget) => {
    const presentation = getTargetPresentation(target.surface);
    const Icon = presentation.icon;
    return (
      <Button
        type='button'
        key={getSecondBrainUiTargetIdentity(target)}
        variant='ghost'
        className='group/action h-auto min-h-11 w-full justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left shadow-sm hover:border-primary/40 hover:bg-accent'
        onClick={() => executeSecondBrainUiTarget({ target, pageContext, navigate, confirmNavigation: () => window.confirm(t('navigation.unsaved')) })}>
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
            <Button type='button' variant='ghost' size='icon' className='size-9' title={t('newConversation')} aria-label={t('newConversation')} disabled={loading} onClick={() => { void secondBrain.createNewConversation().then((created) => { if (created) { setInput(''); setScrollRequest((request) => request + 1); } }); }}>
              <MessageSquarePlus className='size-4' />
            </Button>
            <Button type='button' variant='ghost' size='icon' className='size-9' title={t('history.open')} aria-label={t('history.open')} disabled={loading} onClick={() => { setHistoryOpen(true); void secondBrain.refreshHistory(); }}>
              <History className='size-4' />
            </Button>
            {!useDrawer && <Button type='button' variant='ghost' size='icon' className='size-9' aria-label={t('close')} onClick={() => setOpen(false)}>
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
                  <>
                    <SecondBrainActivity components={message.components} isStreaming={message.isStreaming} />
                    {message.text && <Streamdown className='min-w-0 w-full max-w-full overflow-hidden break-words [&_code]:[overflow-wrap:anywhere] [&_ol]:my-2 [&_ol]:pl-5 [&_p]:my-2 [&_p]:[overflow-wrap:anywhere] [&_pre]:w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre_code]:break-normal [&_pre_code]:[overflow-wrap:normal] [&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_ul]:my-2 [&_ul]:pl-5'>{message.text}</Streamdown>}
                  </>
                ) : <p className='whitespace-pre-wrap break-words'>{message.text}</p>}
              </div>
              {message.targets && message.targets.length > 0 && (
                <div className='mt-3 space-y-2'>
                  <p className='text-[11px] font-medium text-muted-foreground'>{t('navigation.related')}</p>
                  {message.targets.map(renderAction)}
                </div>
              )}
            </article>
          ))}
        </ChatConversationContent>
        <ChatScrollButton className='bottom-3 z-10' aria-label={t('scrollLatest')} title={t('scrollLatest')} />
      </ChatConversation>
      <footer className='shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
        <label htmlFor='second-brain-message' className='sr-only'>{t('placeholder')}</label>
        <div className='flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring'>
          <Textarea id='second-brain-message' name='secondBrainMessage' value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('placeholder')} className='max-h-32 min-h-10 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0' onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
          <Button type='button' size='icon' className='size-11 shrink-0 rounded-lg' onClick={(event) => { event.preventDefault(); event.stopPropagation(); void sendMessage(); }} disabled={loading || !input.trim()} aria-label={t('sendLabel')}><Send className='size-4' /></Button>
        </div>
      </footer>
    </>
  );

  if (!showMascot) return null;

  return (
    <>
      {!open && (
        <Button ref={launcherRef} type='button' className='pointer-events-auto fixed bottom-5 right-5 z-[120] h-14 touch-manipulation rounded-full border border-primary-foreground/20 px-5 shadow-xl shadow-primary/20' aria-label={t('open')} onClick={(event) => { event.preventDefault(); event.stopPropagation(); hasOpenedRef.current = true; if (designerOpen) setDesignerOpen(false); setOpen(true); }}>
          <Sparkles className='mr-2 h-5 w-5' />
          {t('title')}
        </Button>
      )}
      {open && useDrawer && (
        <Sheet open onOpenChange={setOpen}>
          <SheetContent className='pointer-events-auto z-[110] flex w-full flex-col gap-0 p-0 [&>button]:right-3 [&>button]:top-3 [&>button]:grid [&>button]:size-11 [&>button]:place-items-center [&>button_svg]:size-5 sm:max-w-md' aria-label={t('title')} closeLabel={t('close')}>
            <SheetHeader className='sr-only'><SheetTitle>{t('title')}</SheetTitle><SheetDescription>{t('description')}</SheetDescription></SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      )}
      {open && !useDrawer && (
        <ResizablePanel
          storageKey={SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY}
          defaultWidth={SECOND_BRAIN_PANEL_DEFAULT_WIDTH}
          minWidth={SECOND_BRAIN_PANEL_MIN_WIDTH}
          maxWidthRatio={SECOND_BRAIN_PANEL_MAX_WIDTH_RATIO}
          handlePosition='left'
          withHandle
          resizeHandleLabel={t('resize')}
          className='z-[90] h-svh border-l bg-background shadow-[-8px_0_24px_-20px_hsl(var(--foreground))]'
        >
          <aside className='flex h-full min-w-0 flex-1 flex-col' aria-label={t('title')}>
            {panel}
          </aside>
        </ResizablePanel>
      )}
      <SecondBrainHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        conversations={secondBrain.history}
        activeConversationId={secondBrain.conversationId}
        loading={secondBrain.historyLoading || secondBrain.loading}
        onSelect={secondBrain.selectConversation}
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

function getContextLabelKey(pageContext: SecondBrainPageContext): 'context.execution' | 'context.playbook' | 'context.library' | 'context.platform' {
  if (pageContext.entity?.type === 'execution') return 'context.execution';
  if (pageContext.entity?.type === 'playbook') return 'context.playbook';
  if (pageContext.module === 'playbooks') return 'context.library';
  return 'context.platform';
}

function getTargetPresentation(surface: SecondBrainUiTarget['surface']) {
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

function toDisplayMessage(message: ConversationMessage, isStreaming = false): Message | null {
  const components = message.components ?? [];
  const displayMessage: Message = {
    id: message.id,
    role: message.conversationType === 'user' ? 'user' : 'assistant',
    text: message.conversationType === 'user' ? message.content ?? '' : getAssistantText(components),
    components,
    isStreaming,
    targets: dedupeSecondBrainUiTargets(components.flatMap((component) => findUiTargets(getToolResult(component)))),
  };
  if (displayMessage.role === 'assistant'
    && !displayMessage.text
    && !displayMessage.targets?.length
    && !isStreaming
    && !components.some((component) => ['reasoning', 'chainOfThought', 'toolInfo', 'plan', 'queue', 'checkpoint', 'task'].includes(component.type))) {
    return null;
  }
  return displayMessage;
}

function getAssistantText(components: MessageComponent[]): string {
  return components
    .filter((component) => component.type === 'text' || component.type === 'code' || component.type === 'error')
    .map((component) => {
      const content = component.data.content ?? component.data.text;
      if (typeof content !== 'string') return '';
      return component.type === 'error' ? `\n\n${content}` : content;
    })
    .join('');
}

function getToolResult(component: MessageComponent): unknown {
  if (component.type !== 'toolInfo') return undefined;
  return component.data.resultJson ?? component.data.result_json;
}
