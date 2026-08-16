import * as React from 'react';
import { Activity, ArrowUpRight, Bot, CheckCircle2, Library, ListChecks, Loader2, Send, ShieldCheck, Sparkles, Workflow, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Streamdown } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ResizablePanel } from '@/components/ui/resizable-panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { getExecution } from '@/modules/playbook/api';
import { usePlaybookStore, usePlaybookUiStore } from '@/modules/playbook';
import { confirmSecondBrainAction, rejectSecondBrainAction, runSecondBrainTurn } from './api';
import { dedupeSecondBrainUiTargets, executeSecondBrainUiTarget, findUiTargets, getSecondBrainUiTargetIdentity } from './action-bus';
import type { PendingSecondBrainAction, SecondBrainPageContext, SecondBrainTurnResponse, SecondBrainUiTarget } from './types';

type Message = { id: string; role: 'user' | 'assistant'; text: string; targets?: SecondBrainUiTarget[] };
type PendingActionState = { messageId: string; action: PendingSecondBrainAction };
type MonitoredExecution = { messageId: string; playbookId: string; executionId: string; status: string };

export const SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY = 'ys_second_brain_panel_width';
const SECOND_BRAIN_PANEL_DEFAULT_WIDTH = 400;
const SECOND_BRAIN_PANEL_MIN_WIDTH = 336;
const SECOND_BRAIN_PANEL_MAX_WIDTH_RATIO = 0.5;

export function SecondBrainMascot() {
  const { t, language } = useModuleTranslation('second-brain');
  const location = useLocation();
  const navigate = useNavigate();
  const isDirty = usePlaybookStore((state) => state.isDirty);
  const currentPlaybook = usePlaybookStore((state) => state.currentPlaybook);
  const selectedTaskId = usePlaybookUiStore((state) => state.selectedStepId);
  const designerOpen = usePlaybookUiStore((state) => state.designerOpen);
  const setDesignerOpen = usePlaybookUiStore((state) => state.setDesignerOpen);
  const useDrawer = useCompactAssistantLayout();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [conversationId, setConversationId] = React.useState<string>();
  const [pendingAction, setPendingAction] = React.useState<PendingActionState | null>(null);
  const [execution, setExecution] = React.useState<MonitoredExecution | null>(null);
  const [loading, setLoading] = React.useState(false);
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

  React.useEffect(() => {
    if (!execution || ['completed', 'failed', 'cancelled'].includes(execution.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await getExecution(execution.playbookId, execution.executionId);
        if (!cancelled) setExecution((current) => current ? { ...current, status: latest.status } : null);
      } catch {
        // The existing API client surfaces authenticated request failures.
      }
    };
    const timer = window.setInterval(() => void poll(), 3000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [execution?.executionId, execution?.playbookId, execution?.status]);

  const applyResponse = (response: SecondBrainTurnResponse) => {
    const messageId = crypto.randomUUID();
    setConversationId(response.conversationId);
    setMessages((current) => [...current, {
      id: messageId,
      role: 'assistant',
      text: response.answer,
      targets: dedupeSecondBrainUiTargets(response.toolResults.flatMap((result) => findUiTargets(result.result))),
    }]);
    setPendingAction(response.pendingAction ? { messageId, action: response.pendingAction } : null);
    const identifiers = findExecutionIdentifiers(response.toolResults);
    if (identifiers) setExecution({ messageId, ...identifiers, status: 'queued' });
  };

  const sendMessage = async () => {
    const message = input.trim();
    if (!message || loading) return;
    setInput('');
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: message }]);
    setLoading(true);
    try {
      applyResponse(await runSecondBrainTurn({ message, conversationId, pageContext }));
    } catch (error) {
      handleApiError(error);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: t('error.generic') }]);
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!pendingAction || loading) return;
    setLoading(true);
    try {
      applyResponse(await confirmSecondBrainAction(pendingAction.action.confirmationId));
      setPendingAction(null);
    } catch (error) {
      handleApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const reject = async () => {
    if (!pendingAction || loading) return;
    setLoading(true);
    try {
      await rejectSecondBrainAction(pendingAction.action.confirmationId);
      setPendingAction(null);
    } catch (error) {
      handleApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const routePlaybookId = pageContext.entity?.type === 'playbook' ? pageContext.entity.id : undefined;
  const contextPlaybook = currentPlaybook?.id === routePlaybookId ? currentPlaybook : null;
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
        <div className='flex items-start gap-3 pr-10'>
          <div className='grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm'><Bot className='size-5' /></div>
          <div className='min-w-0 flex-1'>
            <h2 className='text-base font-semibold leading-5'>{t('title')}</h2>
            <p className='mt-0.5 text-xs text-muted-foreground'>{t('description')}</p>
          </div>
          {!useDrawer && (
            <Button type='button' variant='ghost' size='icon' className='absolute right-3 top-3' aria-label={t('close')} onClick={() => setOpen(false)}>
              <X className='size-4' />
            </Button>
          )}
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
      <ScrollArea className='min-h-0 min-w-0 flex-1'>
        <div className='min-w-0 space-y-5 px-4 py-5' aria-live='polite'>
          {messages.length === 0 && (
            <div className='rounded-xl border border-dashed bg-muted/25 p-4'>
              <Sparkles className='size-5 text-primary' />
              <p className='mt-3 text-sm font-medium'>{t('empty.title')}</p>
              <p className='mt-1 text-xs leading-5 text-muted-foreground'>{t('empty.description')}</p>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`min-w-0 max-w-full ${message.role === 'user' ? 'ml-8' : ''}`}>
              <div className='mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground'>
                {message.role === 'assistant' && <Bot className='size-3.5' />}
                {message.role === 'user' ? t('you') : t('assistant')}
              </div>
              <div className={message.role === 'user'
                ? 'rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm'
                : 'min-w-0 max-w-full overflow-hidden text-sm leading-6 text-foreground'}>
                {message.role === 'assistant'
                  ? <Streamdown className='min-w-0 max-w-full break-words [&_code]:break-words [&_ol]:my-2 [&_ol]:pl-5 [&_p]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre_code]:break-normal [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_ul]:my-2 [&_ul]:pl-5'>{message.text}</Streamdown>
                  : <p className='whitespace-pre-wrap break-words'>{message.text}</p>}
              </div>
              {pendingAction?.messageId === message.id && (
                <div className='mt-3 rounded-xl border border-primary/35 bg-primary/5 p-3'>
                  <div className='flex items-center gap-2'><ShieldCheck className='size-4 text-primary' /><h3 className='text-sm font-semibold'>{t('confirmation.title')}</h3></div>
                  <p className='mt-2 text-sm'>{pendingAction.action.summary.playbookName}</p>
                  <p className='mt-1 text-xs text-muted-foreground'>{t('confirmation.validation', { status: pendingAction.action.summary.validationStatus ?? 'valid' })}</p>
                  <p className='text-xs text-muted-foreground'>{pendingAction.action.summary.inputLabels?.length ? t('confirmation.inputs', { inputs: pendingAction.action.summary.inputLabels.join(', ') }) : t('confirmation.noInputs')}</p>
                  <div className='mt-3 flex gap-2'><Button type='button' className='min-h-11' onClick={() => void confirm()} disabled={loading}>{t('confirmation.run')}</Button><Button type='button' className='min-h-11' variant='outline' onClick={() => void reject()} disabled={loading}>{t('confirmation.cancel')}</Button></div>
                </div>
              )}
              {execution?.messageId === message.id && (
                <div className='mt-3 flex items-center gap-2 rounded-lg border bg-muted/35 px-3 py-2 text-xs'>
                  {['completed', 'failed', 'cancelled'].includes(execution.status) ? <CheckCircle2 className='size-4 text-primary' /> : <Loader2 className='size-4 animate-spin text-primary' />}
                  {t('execution.status', { status: execution.status })}
                </div>
              )}
              {message.targets && message.targets.length > 0 && (
                <div className='mt-3 space-y-2'>
                  <p className='text-[11px] font-medium text-muted-foreground'>{t('navigation.related')}</p>
                  {message.targets.map(renderAction)}
                </div>
              )}
            </article>
          ))}
          {loading && <div className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin text-primary' />{t('sending')}</div>}
        </div>
      </ScrollArea>
      <footer className='shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
        <label htmlFor='second-brain-message' className='sr-only'>{t('placeholder')}</label>
        <div className='flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring'>
          <Textarea id='second-brain-message' name='secondBrainMessage' value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('placeholder')} className='max-h-32 min-h-10 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0' onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
          <Button type='button' size='icon' className='size-11 shrink-0 rounded-lg' onClick={(event) => { event.preventDefault(); event.stopPropagation(); void sendMessage(); }} disabled={loading || !input.trim()} aria-label={t('sendLabel')}><Send className='size-4' /></Button>
        </div>
      </footer>
    </>
  );

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
    </>
  );
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

function findExecutionIdentifiers(value: unknown, depth = 0): { playbookId: string; executionId: string } | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') {
    try { return findExecutionIdentifiers(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) { const result = findExecutionIdentifiers(item, depth + 1); if (result) return result; }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const playbookId = record.playbookId ?? record.playbook_id;
  const executionId = record.executionId ?? record.execution_id;
  if (typeof playbookId === 'string' && typeof executionId === 'string') return { playbookId, executionId };
  for (const nested of Object.values(record)) { const result = findExecutionIdentifiers(nested, depth + 1); if (result) return result; }
  return null;
}
