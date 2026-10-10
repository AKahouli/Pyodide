import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useApiAction } from '@/lib/use-api-action';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { fetchRootInputs, submitBackgroundRootInput } from '../api';
import { useConversationStore } from '../store';
import { useConversationUiStore } from '../uiStore';
import { useRootInputUiStore } from '../rootInputUiStore';
import { useRootWorkStore } from '../rootWorkStore';
import type { NativeInputSchema, PendingRootInput } from '../types';
import { encodeNativeInput, NativeInputFields } from './NativeInputFields';
import { nativeInputKey, nativeInputSummary } from './native-input-presentation';
import { Loader2, MessageCircle } from 'lucide-react';

function initialValue(schema?: NativeInputSchema): unknown {
  if (!schema) return undefined;
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {})
    .filter(([key]) => schema.required?.includes(key))
    .map(([key, child]) => [key, initialValue(child)]));
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  return '';
}

function PendingInputForm({ root, input, conversationId, onSubmitted, scope, inputKey }: {
  root: PendingRootInput; input: PendingRootInput['inputs'][number]; conversationId: string;
  scope: string; inputKey: string;
  onSubmitted: () => void;
}) {
  const { t } = useModuleTranslation('conversation');
  const sendMessage = useConversationStore((state) => state.sendMessage);
  const saved = useRootInputUiStore((state) => state.drafts[inputKey]);
  const submitting = useRootInputUiStore((state) => state.submitting.includes(inputKey));
  const continuationFailed = useRootInputUiStore((state) => state.failures.includes(inputKey));
  const task = useRootWorkStore((state) => state.userId && scope === `${state.userId}:${conversationId}`
    ? state.snapshots[conversationId]?.jobs.find((job) => job.executionId === root.executionId)?.task : undefined);
  const value = saved ?? initialValue(input.responseSchema);
  const draft = typeof saved === 'string' ? saved : '';
  const setValue = (next: unknown) => useRootInputUiStore.getState().setDraft(scope, inputKey, next);
  const submit = useCallback(async (response: Record<string, unknown>, content: string) => {
    if (root.mode === 'background') {
      await submitBackgroundRootInput(conversationId, root.executionId,
        [{ inputId: input.inputId, inputVersion: input.inputVersion ?? 1, response }]);
      useRootWorkStore.getState().refresh();
      return true;
    }
    await sendMessage(conversationId, { content, rootContinuation: {
      executionId: root.executionId, inputResponses: [{ inputId: input.inputId, inputVersion: input.inputVersion ?? 1, response }],
    } }, (messageId) => useRootInputUiStore.getState().bindContinuation(scope, inputKey, messageId));
    return true;
  }, [sendMessage, conversationId, root.executionId, root.mode, input.inputId, input.inputVersion, scope, inputKey]);
  const { execute, isLoading: loading, error } = useApiAction(submit, { showErrorToast: false });
  const isLoading = loading || submitting;
  async function send(response: Record<string, unknown>, content: string) {
    const state = useRootInputUiStore.getState();
    if (state.scope !== scope || state.submitting.includes(inputKey)) return;
    state.setSubmitting(scope, inputKey, true);
    try {
      if (await execute(response, content)) onSubmitted();
    } finally {
      useRootInputUiStore.getState().setSubmitting(scope, inputKey, false);
    }
  }
  return <form aria-label={input.message || t('rootInput.title')} className='space-y-4 py-3' onSubmit={(event) => {
    event.preventDefault();
    if (input.responseSchemaUnsupported) return;
    const response = encodeNativeInput(input.responseSchema ? value : draft);
    void send(response, input.responseSchema ? nativeInputSummary(value, input.responseSchema) : draft);
  }}>
    {task && <p className='text-xs text-muted-foreground break-words'>{task}</p>}
    <p className='text-sm font-medium'>{input.message || t(input.kind === 'confirmation' ? 'rootInput.confirmation' : 'rootInput.title')}</p>
    {input.responseSchemaUnsupported ? <p role='status' className='text-sm'>{t('rootInput.unsupportedFormat')}</p>
      : input.kind === 'confirmation' ? <div className='flex flex-wrap gap-2'>
      <Button type='button' disabled={isLoading} onClick={() => void send({ confirmed: true }, t('rootInput.approved'))}>
        {t('rootInput.approve')}
      </Button>
      <Button type='button' variant='outline' disabled={isLoading} onClick={() => void send({ confirmed: false }, t('rootInput.rejected'))}>
        {t('rootInput.reject')}
      </Button>
    </div> : <>
      {input.responseSchema ? <NativeInputFields schema={input.responseSchema} value={value} onChange={setValue}
        label={t('rootInput.response')} required disabled={isLoading} /> : <label className='block space-y-2 text-sm'>
        <span>{t('rootInput.response')}</span>
        <Textarea value={draft} onChange={(event) => setValue(event.target.value)} required maxLength={16000} disabled={isLoading} />
      </label>}
      <div className='flex flex-wrap items-center gap-3'>
        <Button type='submit' disabled={isLoading} aria-busy={isLoading}>
          {isLoading && <Loader2 className='mr-2 size-4 animate-spin motion-reduce:animate-none' aria-hidden='true' />}
          {t(isLoading ? 'rootInput.sending' : 'rootInput.continue')}
        </Button>
        <span className='text-xs text-muted-foreground'>{t('rootInput.otherRequests')}</span>
      </div>
    </>}
    {error && <p role='alert' className='text-sm text-destructive'>{error.message}</p>}
    {continuationFailed && <p role='alert' className='text-sm text-destructive'>{t('rootInput.continuationFailed')}</p>}
  </form>;
}

function RootInputPanelContent({ conversationId, creatorId, variant = 'dock', messageId }: {
  conversationId: string; creatorId: string; variant?: 'dock' | 'details' | 'inline'; messageId?: string;
}) {
  const { user } = useAuth();
  const { t } = useModuleTranslation('conversation');
  const scope = `${user?.id || ''}:${conversationId}`;
  const state = useRootInputUiStore();
  const revision = useRootWorkStore((work) => work.revision);
  const { execute } = useApiAction(fetchRootInputs, { showErrorToast: false });
  useEffect(() => {
    if (variant !== 'dock') return;
    useRootInputUiStore.getState().reset(scope);
  }, [scope, variant]);
  useEffect(() => {
    if (variant !== 'dock') return;
    if (user?.id !== creatorId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || abort.signal.aborted) return;
      refreshing = true;
      const result = await execute(conversationId, abort.signal);
      refreshing = false;
      if (abort.signal.aborted) return;
      if (result) useRootInputUiStore.getState().setRoots(scope, result);
      timer = setTimeout(() => void refresh(), 5000);
    };
    const onFocus = () => { clearTimeout(timer); void refresh(); };
    void refresh();
    window.addEventListener('focus', onFocus);
    return () => { abort.abort(); clearTimeout(timer); window.removeEventListener('focus', onFocus); };
  }, [conversationId, creatorId, user?.id, execute, variant, scope, revision]);
  if (user?.id !== creatorId || state.scope !== scope) return null;
  const pending = state.roots.flatMap((root) => root.inputs.map((input) => ({ root, input,
    key: nativeInputKey(root, input) })))
    .filter(({ key }) => !state.submitted.includes(key));
  if (!pending.length) return null;
  if (variant === 'dock') return <div className='mx-auto w-full max-w-6xl shrink-0 px-4'>
    <Button variant='ghost' className='h-9 max-w-full justify-start text-primary' onClick={() => {
      const origin = pending[0]?.root.originAssistantMessageId;
      if (origin && document.getElementById(`message-${origin}`)) {
        useConversationUiStore.getState().requestOutlineScroll(`message-${origin}`);
      } else useConversationUiStore.getState().setContextPanel('work');
    }}>
      {t('rootInput.pendingCount', { count: pending.length })}
    </Button>
  </div>;
  const visible = variant === 'inline' ? pending.filter(({ root }) => root.originAssistantMessageId === messageId) : pending;
  if (!visible.length) return null;
  return <section aria-label={t('rootInput.title')} className={variant === 'inline' ? 'mt-4 border-t pt-3' : 'space-y-3 p-3'}>
    <div className='flex items-center gap-2 text-sm font-medium text-primary' role='status'>
      <MessageCircle className='size-4' aria-hidden='true' />{t('rootInput.waiting')}
    </div>
    {visible.map(({ root, input, key }) => variant === 'details' && root.originAssistantMessageId
      ? <div key={key} className='space-y-2 py-3'>
        <p className='text-sm'>{input.message || t('rootInput.title')}</p>
        <Button size='sm' variant='outline' onClick={() => {
          useConversationUiStore.getState().setContextPanel(null);
          useConversationUiStore.getState().requestOutlineScroll(`message-${root.originAssistantMessageId}`);
        }}>{t('rootInput.answerInChat')}</Button>
      </div>
      : <PendingInputForm key={key}
      root={root} input={input} conversationId={conversationId} scope={scope} inputKey={key}
      onSubmitted={() => useRootInputUiStore.getState().markSubmitted(scope, key)} />)}
  </section>;
}

export function RootInputPanel(props: { conversationId: string; creatorId: string; variant?: 'dock' | 'details' | 'inline'; messageId?: string }) {
  return <RootInputPanelContent key={`${props.conversationId}:${props.creatorId}`} {...props} />;
}
