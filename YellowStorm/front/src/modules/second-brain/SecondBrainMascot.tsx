import * as React from 'react';
import { Bot, Loader2, Send, Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { getExecution } from '@/modules/playbook/api';
import { usePlaybookStore, usePlaybookUiStore } from '@/modules/playbook';
import { confirmSecondBrainAction, rejectSecondBrainAction, runSecondBrainTurn } from './api';
import { executeSecondBrainUiTarget, findUiTargets } from './action-bus';
import type { PendingSecondBrainAction, SecondBrainPageContext, SecondBrainTurnResponse, SecondBrainUiTarget } from './types';

type Message = { id: string; role: 'user' | 'assistant'; text: string };
type MonitoredExecution = { playbookId: string; executionId: string; status: string };

export function SecondBrainMascot() {
  const { t, language } = useModuleTranslation('second-brain');
  const location = useLocation();
  const navigate = useNavigate();
  const isDirty = usePlaybookStore((state) => state.isDirty);
  const selectedTaskId = usePlaybookUiStore((state) => state.selectedStepId);
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [conversationId, setConversationId] = React.useState<string>();
  const [pendingAction, setPendingAction] = React.useState<PendingSecondBrainAction | null>(null);
  const [targets, setTargets] = React.useState<SecondBrainUiTarget[]>([]);
  const [execution, setExecution] = React.useState<MonitoredExecution | null>(null);
  const [loading, setLoading] = React.useState(false);
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const hasOpenedRef = React.useRef(false);

  React.useEffect(() => {
    if (open || !hasOpenedRef.current) return;
    const frame = window.requestAnimationFrame(() => launcherRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

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
    setConversationId(response.conversationId);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: response.answer }]);
    setPendingAction(response.pendingAction);
    setTargets(response.toolResults.flatMap((result) => findUiTargets(result.result)));
    const identifiers = findExecutionIdentifiers(response.toolResults);
    if (identifiers) setExecution({ ...identifiers, status: 'queued' });
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
      applyResponse(await confirmSecondBrainAction(pendingAction.confirmationId));
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
      await rejectSecondBrainAction(pendingAction.confirmationId);
      setPendingAction(null);
    } catch (error) {
      handleApiError(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!open && (
        <Button ref={launcherRef} type='button' className='pointer-events-auto fixed bottom-5 right-5 z-[120] h-14 touch-manipulation rounded-full border border-primary-foreground/20 px-5 shadow-xl shadow-primary/20' aria-label={t('open')} onClick={(event) => { event.preventDefault(); event.stopPropagation(); hasOpenedRef.current = true; setOpen(true); }}>
          <Sparkles className='mr-2 h-5 w-5' />
          {t('title')}
        </Button>
      )}
      <SheetContent className='pointer-events-auto z-[110] flex w-full flex-col gap-0 p-0 sm:max-w-md' aria-label={t('title')} closeLabel={t('close')}>
        <SheetHeader className='border-b bg-gradient-to-br from-primary/15 via-background to-background px-6 py-5 text-left'>
          <div className='flex items-center gap-3'>
            <div className='grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground'><Bot className='h-5 w-5' /></div>
            <div><SheetTitle>{t('title')}</SheetTitle><SheetDescription>{t('description')}</SheetDescription></div>
          </div>
          <div className='flex flex-wrap gap-2 pt-2'>
            {pageContext.entity?.type === 'playbook' && <Badge variant='secondary'>{t('context.playbook', { id: pageContext.entity.id })}</Badge>}
            {pageContext.entity?.type === 'execution' && <Badge variant='secondary'>{t('context.execution', { id: pageContext.entity.id })}</Badge>}
            {pageContext.selection?.type === 'task' && <Badge variant='outline'>{t('context.task', { id: pageContext.selection.id })}</Badge>}
          </div>
        </SheetHeader>
        <ScrollArea className='flex-1 px-5 py-4'>
          <div className='space-y-4'>
            {messages.length === 0 && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('empty')}</p>}
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'ml-8 rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm text-primary-foreground' : 'mr-5 rounded-2xl rounded-bl-sm border bg-card px-4 py-3 text-sm'}>
                <span className='mb-1 block text-xs font-semibold opacity-70'>{message.role === 'user' ? t('you') : t('assistant')}</span>
                <p className='whitespace-pre-wrap'>{message.text}</p>
              </div>
            ))}
            {pendingAction && (
              <div className='rounded-2xl border-2 border-primary/35 bg-primary/5 p-4'>
                <h3 className='font-semibold'>{t('confirmation.title')}</h3>
                <p className='mt-1 text-sm'>{pendingAction.summary.playbookName}</p>
                <p className='mt-2 text-xs text-muted-foreground'>{t('confirmation.validation', { status: pendingAction.summary.validationStatus ?? 'valid' })}</p>
                <p className='text-xs text-muted-foreground'>{pendingAction.summary.inputLabels?.length ? t('confirmation.inputs', { inputs: pendingAction.summary.inputLabels.join(', ') }) : t('confirmation.noInputs')}</p>
                <div className='mt-4 flex gap-2'><Button type='button' size='sm' onClick={() => void confirm()} disabled={loading}>{t('confirmation.run')}</Button><Button type='button' size='sm' variant='outline' onClick={() => void reject()} disabled={loading}>{t('confirmation.cancel')}</Button></div>
              </div>
            )}
            {execution && <div className='rounded-xl border px-4 py-3 text-sm'>{t('execution.status', { status: execution.status })}</div>}
            {targets.map((target, index) => (
              <Button type='button' key={`${target.surface}-${index}`} variant='outline' className='w-full justify-start' onClick={() => executeSecondBrainUiTarget({ target, pageContext, navigate, confirmNavigation: () => window.confirm(t('navigation.unsaved')) })}>
                {t('navigation.open')}
              </Button>
            ))}
            {loading && <div className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' />{t('sending')}</div>}
          </div>
        </ScrollArea>
        <div className='border-t bg-background p-4'>
          <div className='flex items-end gap-2'>
            <Textarea id='second-brain-message' name='secondBrainMessage' value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('placeholder')} className='min-h-11 resize-none' onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
            <Button type='button' size='icon' onClick={(event) => { event.preventDefault(); event.stopPropagation(); void sendMessage(); }} disabled={loading || !input.trim()} aria-label={t('sendLabel')}><Send className='h-4 w-4' /></Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
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
