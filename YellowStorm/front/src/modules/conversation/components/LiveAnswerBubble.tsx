import { useState } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore } from '../store';
import type { LiveAnswer } from '../live-streams';
import type { ChoiceInteractionMetadata } from '../types';
import { ConversationAssistantBubble } from './activity/ConversationAssistantBubble';

export function LiveAnswerBubble({ answer, choiceInteractions }: { answer: LiveAnswer; choiceInteractions: Map<string, ChoiceInteractionMetadata> }) {
  const { t } = useModuleTranslation('conversation');
  const stopStream = useConversationStore((state) => state.stopStream);
  const sendMessage = useConversationStore((state) => state.sendMessage);
  const [stopping, setStopping] = useState(false);
  return <div className='group/msg' id={`message-${answer.messageId}`}>
    <MessageProvider isStreaming isLastAiMessage>
      <ConversationAssistantBubble conversationId={answer.conversationId} messageId={answer.messageId} components={answer.components} isStreaming showWorking={answer.components.length === 0} choiceInteractions={choiceInteractions}
        onComponentAction={(action) => sendMessage(answer.conversationId, { content: action.submitText, interaction: { ...action.interaction, sourceMessageId: answer.messageId } })}
        onSubmitQuestions={(actions) => sendMessage(answer.conversationId, { content: actions.map((action) => action.submitText).join(' '), interactions: actions.map((action) => ({ ...action.interaction, sourceMessageId: answer.messageId })) })} showUiTargets />
      <Button variant='ghost' size='sm' disabled={stopping} onClick={async () => {
        setStopping(true);
        try { await stopStream(answer.messageId, answer.conversationId); } finally { setStopping(false); }
      }}><Square className='size-3' />{t('input.stopReply')}</Button>
    </MessageProvider>
  </div>;
}
