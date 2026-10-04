import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useApiAction } from '@/lib/use-api-action';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { fetchRootInputs } from '../api';
import { useConversationStore } from '../store';
import type { NativeInputSchema, PendingRootInput } from '../types';
import { encodeNativeInput, NativeInputFields } from './NativeInputFields';

function initialValue(schema?: NativeInputSchema): unknown {
  if (!schema) return undefined;
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {})
    .filter(([key]) => schema.required?.includes(key))
    .map(([key, child]) => [key, initialValue(child)]));
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  return '';
}

function PendingInputForm({ root, input, conversationId, onSubmitted }: {
  root: PendingRootInput; input: PendingRootInput['inputs'][number]; conversationId: string;
  onSubmitted: () => void;
}) {
  const { t } = useModuleTranslation('conversation');
  const sendMessage = useConversationStore((state) => state.sendMessage);
  const [value, setValue] = useState<unknown>(() => initialValue(input.responseSchema));
  const [draft, setDraft] = useState('');
  const submit = useCallback(async (response: Record<string, unknown>, content: string) => {
    await sendMessage(conversationId, { content, rootContinuation: {
      executionId: root.executionId, inputResponses: [{ inputId: input.inputId, inputVersion: input.inputVersion ?? 1, response }],
    } });
    return true;
  }, [sendMessage, conversationId, root.executionId, input.inputId, input.inputVersion]);
  const { execute, isLoading, error } = useApiAction(submit, { showErrorToast: false });
  async function send(response: Record<string, unknown>, content: string) {
    if (await execute(response, content)) onSubmitted();
  }
  return <form className='space-y-3 rounded-lg border bg-muted/20 p-4' onSubmit={(event) => {
    event.preventDefault();
    if (input.responseSchemaUnsupported) return;
    const response = encodeNativeInput(input.responseSchema ? value : draft);
    void send(response, input.responseSchema ? JSON.stringify(value) : draft);
  }}>
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
        <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} required maxLength={16000} disabled={isLoading} />
      </label>}
      <Button type='submit' disabled={isLoading}>{t('rootInput.continue')}</Button>
    </>}
    {error && <p role='alert' className='text-sm text-destructive'>{error.message}</p>}
  </form>;
}

function RootInputPanelContent({ conversationId, creatorId }: { conversationId: string; creatorId: string }) {
  const { user } = useAuth();
  const [roots, setRoots] = useState<PendingRootInput[]>([]);
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());
  const { execute } = useApiAction(fetchRootInputs, { showErrorToast: false });
  useEffect(() => {
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
      if (result) setRoots(result);
      timer = setTimeout(() => void refresh(), 5000);
    };
    const onFocus = () => { clearTimeout(timer); void refresh(); };
    void refresh();
    window.addEventListener('focus', onFocus);
    return () => { abort.abort(); clearTimeout(timer); window.removeEventListener('focus', onFocus); };
  }, [conversationId, creatorId, user?.id, execute]);
  if (user?.id !== creatorId) return null;
  const pending = roots.flatMap((root) => root.inputs.map((input) => ({ root, input,
    key: `${root.executionId}:${root.epoch}:${input.inputId}:${input.inputVersion ?? 1}` })));
  return <div className='mx-auto w-full max-w-6xl space-y-3 px-4'>
    {pending.filter(({ key }) => !submitted.has(key)).map(({ root, input, key }) => <PendingInputForm key={key}
      root={root} input={input} conversationId={conversationId}
      onSubmitted={() => setSubmitted((previous) => new Set([...previous, key]))} />)}
  </div>;
}

export function RootInputPanel(props: { conversationId: string; creatorId: string }) {
  return <RootInputPanelContent key={`${props.conversationId}:${props.creatorId}`} {...props} />;
}
