import { useContext, useEffect, useId, useState } from 'react';
import { useFormName, useStateField } from '@openuidev/react-lang';
import { Button } from '@/components/ui/button';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { useModuleTranslation } from '@/modules/localization';
import { fetchConversationFiles, fetchMessage } from '../../api';
import { useConversationStore } from '../../store';
import type { Message } from '../../types';
import { submissionSignature } from './actions';
import { MiniAppTaskContext, findMiniAppTask } from './mini-app-task-context';
import { isOpenUiProgram, programToPlainText } from './plain-text';
import { MiniDocument, MiniTaskResult } from './mini-app-definitions';

export const miniAppTaskComponents = [
  { ...MiniDocument, component: ({ props }: Parameters<typeof MiniDocument.component>[0]) => {
    const scope = useContext(MiniAppTaskContext); const { t } = useModuleTranslation('conversation');
    const field = useStateField(props.name, props.value); const id = useId();
    const [page, setPage] = useState(1); const [attempt, setAttempt] = useState(0);
    const [view, setView] = useState<{ documents: Array<{ id: string; label: string }>; pages: number; loading: boolean; error: boolean }>({ documents: [], pages: 1, loading: true, error: false });
    useEffect(() => {
      let active = true;
      setView(previous => ({ ...previous, loading: true, error: false }));
      if (!scope) { setView({ documents: [], pages: 1, loading: false, error: true }); return; }
      void fetchConversationFiles(scope.conversationId, { page, limit: 50 }).then(result => {
        if (active) setView({ documents: result.documents.filter(document => document.status === 'completed' && !document.isFolder)
          .map(document => ({ id: document.id, label: document.originalName || document.filename })), pages: result.pagination.totalPages, loading: false, error: false });
      }).catch(() => { if (active) setView({ documents: [], pages: 1, loading: false, error: true }); });
      return () => { active = false; };
    }, [scope?.conversationId, scope?.actorId, page, attempt]);
    const value = typeof field.value === 'string' ? field.value : '';
    return <div className='space-y-2'>
      <label htmlFor={id} className='text-sm font-medium'>{props.label}</label>
      <select id={id} name={props.name} required={props.required} disabled={view.loading || view.error} value={value}
        onChange={event => field.setValue(event.target.value)} className='h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'>
        <option value=''>{t('openui.task.chooseDocument')}</option>
        {value && !view.documents.some(document => document.id === value) && <option value={value}>{t('openui.task.unavailableDocument')}</option>}
        {view.documents.map(document => <option key={document.id} value={document.id}>{document.label}</option>)}
      </select>
      <p role={view.error ? 'alert' : 'status'} className='text-xs text-muted-foreground'>{t(view.error ? 'openui.task.documentError' : view.loading ? 'openui.task.documentsLoading' : 'openui.task.uploadHint')}</p>
      <div className='flex gap-2'>
        <Button type='button' size='sm' variant='outline' onClick={() => setAttempt(value => value + 1)}>{t('openui.task.refresh')}</Button>
        {page > 1 && <Button type='button' size='sm' variant='outline' onClick={() => setPage(value => value - 1)}>{t('openui.task.previous')}</Button>}
        {page < view.pages && <Button type='button' size='sm' variant='outline' onClick={() => setPage(value => value + 1)}>{t('openui.task.next')}</Button>}
      </div>
    </div>;
  } },
  { ...MiniTaskResult, component: ({ props }: Parameters<typeof MiniTaskResult.component>[0]) => {
    const scope = useContext(MiniAppTaskContext); const formName = useFormName() ?? ''; const { t } = useModuleTranslation('conversation');
    const messages = useConversationStore(state => state.messages);
    const task = scope ? findMiniAppTask(messages, scope, formName) : undefined;
    const stored = task ? messages.find(message => message.id === task.answerMessageId || message.questionMessageId === task.id) : undefined;
    const [fetched, setFetched] = useState<Message>(); const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
    const answer = stored ?? (fetched?.id === task?.answerMessageId ? fetched : undefined);
    const answerId = task?.answerMessageId;
    useEffect(() => {
      let active = true; setFailed(false); setFetched(undefined);
      if (scope && answerId && !stored) void fetchMessage(scope.conversationId, answerId).then(message => { if (active) setFetched(message); }).catch(() => { if (active) setFailed(true); });
      return () => { active = false; };
    }, [scope?.conversationId, scope?.actorId, answerId, Boolean(stored), attempt]);
    const interaction = task?.interaction?.type === 'openui' ? task.interaction : undefined;
    const stale = interaction && (scope?.dirty || interaction.appTask?.stateRevision !== scope?.stateRevision
      || submissionSignature(interaction.params?.inputs) !== submissionSignature(props.inputs));
    const running = scope?.running?.formName === formName;
    const cancelled = answer?.terminalStatus === 'cancelled';
    const error = failed || ['failed', 'interrupted'].includes(answer?.terminalStatus ?? '') || answer?.components?.some(component => component.type === 'error');
    const complete = answer?.isComplete && !cancelled && !error;
    const status = stale ? 'stale' : cancelled ? 'cancelled' : error ? 'error' : complete ? 'completed' : task || running ? 'running' : 'idle';
    const text = answer?.components?.filter(component => component.type === 'text').map(component => String(component.data.content ?? '')).join('\n\n') || answer?.content;
    const cancelId = scope?.running?.answerId ?? answerId;
    const [cancelling, setCancelling] = useState(false); const [cancelError, setCancelError] = useState(false);
    return <section aria-label={props.label} className='space-y-2 border-t border-border pt-3'>
      <h4 className='text-sm font-medium'>{props.label}</h4>
      <p role={error || stale ? 'alert' : 'status'} className='text-sm text-muted-foreground'>{t(`openui.task.${status}`)}</p>
      {!stale && complete && text && <AIMessageContent parts={[{ type: 'text', content: isOpenUiProgram(text) ? programToPlainText(text) : text }]} citationScope={scope && answer ? { conversationId: scope.conversationId, messageId: answer.id } : undefined} />}
      {failed && <Button type='button' size='sm' variant='outline' onClick={() => setAttempt(value => value + 1)}>{t('openui.draft.retry')}</Button>}
      {!complete && !cancelled && !error && cancelId && scope && <Button type='button' size='sm' variant='outline' disabled={cancelling} onClick={() => {
        setCancelling(true); setCancelError(false);
        void scope.cancel(cancelId).catch(() => setCancelError(true)).finally(() => setCancelling(false));
      }}>{t('openui.task.cancel')}</Button>}
      {cancelError && <p role='alert'>{t('openui.task.cancelError')}</p>}
    </section>;
  } },
];
