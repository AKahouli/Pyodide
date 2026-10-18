import { useEffect } from 'react';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationUiStore } from '../uiStore';

/** An explicit reference in the draft is a selector, never an access grant. */
export function AssetPromptBridge({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const { t } = useModuleTranslation('conversation');
  const { textInput } = usePromptInputController();
  const request = useConversationUiStore(state => state.assetPromptRequest);
  useEffect(() => {
    if (!request || request.conversationId !== conversationId || request.actorId !== user?.id) return;
    const reference = t('assets.promptReference', { name: request.name.replace(/[\r\n]/g, ' '), ref: request.ref });
    textInput.setInput(`${textInput.value}${textInput.value ? '\n' : ''}${reference}\n`);
    useConversationUiStore.getState().consumeAssetPrompt();
  }, [request, conversationId, user?.id, textInput, t]);
  return null;
}
