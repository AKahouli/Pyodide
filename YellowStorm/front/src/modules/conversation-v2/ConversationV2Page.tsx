import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { conversationV2Api } from './api';
import { useConversationV2Store } from './store';
import { useConversationV2Translation } from './translation';

export default function ConversationV2Page() {
  const navigate = useNavigate();
  const reset = useConversationV2Store((s) => s.reset);
  const { t } = useConversationV2Translation();

  const startNew = async () => {
    reset();
    const { sessionId } = await conversationV2Api.createSession();
    navigate(`/conversation-v2/${sessionId}`);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">{t('page.title')}</h1>
      <p className="text-muted-foreground">{t('page.emptyState')}</p>
      <Button onClick={startNew}>{t('page.newChat')}</Button>
    </div>
  );
}
