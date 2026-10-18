import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { MAX_SELECTED_CONVERSATION_ASSETS, useConversationUiStore } from '../uiStore';

/** Explicit selectors stay out of the editable draft; permissions remain server-owned. */
export function AssetPromptBridge({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const { t } = useModuleTranslation('conversation');
  const { textInput } = usePromptInputController();
  const [limitReached, setLimitReached] = useState(false);
  const request = useConversationUiStore(state => state.assetPromptRequest);
  const selection = useConversationUiStore(state => state.selectedAssets);
  const actorId = user?.id ?? '';
  const items = selection?.actorId === actorId && selection.conversationId === conversationId ? selection.items : [];
  useEffect(() => {
    useConversationUiStore.getState().scopeAssetSelection(actorId, conversationId);
    setLimitReached(false);
  }, [actorId, conversationId]);
  useEffect(() => {
    if (!request || request.conversationId !== conversationId || request.actorId !== actorId) return;
    const accepted = useConversationUiStore.getState().addAssetSelection(actorId, conversationId, request.ref, request.name, request.intent === 'refine' ? request.sourceMessageId : undefined);
    setLimitReached(!accepted);
    if (accepted && request.intent === 'refine') {
      const prompt = t('assets.refinePrompt');
      if (!textInput.value.endsWith(prompt)) textInput.setInput(`${textInput.value}${textInput.value ? '\n\n' : ''}${prompt}`);
    }
    useConversationUiStore.getState().consumeAssetPrompt();
  }, [request, conversationId, actorId, textInput, t]);
  if (!items.length && !limitReached) return null;
  return <div className='px-3 pb-2' role='group' aria-label={t('assets.selectedFiles')}>
    <div className='flex flex-wrap gap-1.5'>
      {items.map(item => <span key={item.nonce} className='inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 text-xs'>
        <FileText className='size-3 shrink-0 text-muted-foreground' aria-hidden />
        <span className='min-w-0 truncate' title={item.name}>{item.name}</span>
        <Button type='button' variant='ghost' size='icon' className='size-7 shrink-0' aria-label={t('assets.removeSelection', { name: item.name })} onClick={() => { useConversationUiStore.getState().removeAssetSelection(actorId, conversationId, item.nonce); setLimitReached(false); }}><X className='size-3' /></Button>
      </span>)}
    </div>
    {limitReached && <p role='status' className='mt-1 text-xs text-muted-foreground'>{t('assets.selectionLimit', { count: MAX_SELECTED_CONVERSATION_ASSETS })}</p>}
  </div>;
}
