import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { fetchMessage, fetchRootResult } from '../api';
import { useConversationUiStore } from '../uiStore';
import { useRootWorkStore } from '../rootWorkStore';

export function WorkMessageLink({ conversationId, messageId, executionId, kind = 'result' }: {
  conversationId: string; messageId: string; executionId?: string; kind?: 'result' | 'request';
}) {
  const { t } = useModuleTranslation('conversation');
  const { execute: message, isLoading: messageLoading, error: messageError } = useApiAction(fetchMessage, { showErrorToast: false });
  const { execute: result, isLoading: resultLoading, error: resultError } = useApiAction(fetchRootResult, { showErrorToast: false });
  const [content, setContent] = useState<string>();
  const [complete, setComplete] = useState(true);
  const setContextPanel = useConversationUiStore((state) => state.setContextPanel);
  const requestScroll = useConversationUiStore((state) => state.requestOutlineScroll);
  const loading = messageLoading || resultLoading;
  return <div className='min-w-0'>
    <Button size='sm' variant='link' className='h-8 px-0' disabled={loading} aria-busy={loading} onClick={async () => {
      if (document.getElementById(`message-${messageId}`)) {
        setContextPanel(null); requestScroll(`message-${messageId}`); return;
      }
      if (executionId && kind === 'result') {
        const response = await result(conversationId, executionId);
        if (!response) return;
        setContent(response.text); setComplete(response.complete);
      } else {
        const response = await message(conversationId, messageId);
        if (!response) return;
        setContent(response.content || response.components?.flatMap((component) => component.type === 'text'
          && 'content' in component.data && typeof component.data.content === 'string' ? [component.data.content] : []).join('\n') || '');
      }
      if (kind === 'result') useRootWorkStore.getState().markResultRead(conversationId, messageId);
    }}>{t(loading ? 'page.loading' : kind === 'result' ? 'rootWork.viewResult' : 'rootWork.viewRequest')}</Button>
    {(messageError || resultError) && <p role='alert' className='text-sm text-destructive'>{(messageError || resultError)?.message}</p>}
    {content !== undefined && <div className='py-2' role='region' aria-label={t(kind === 'result' ? 'rootWork.result' : 'rootWork.viewRequest')}>
      {!complete && <p className='text-xs text-muted-foreground'>{t('rootWork.partialResult')}</p>}
      <pre className='max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm'>{content}</pre>
    </div>}
  </div>;
}
