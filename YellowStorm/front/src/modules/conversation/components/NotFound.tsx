import { ChatConversationEmptyState } from '@/components/ai-elements/chat-conversation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useModuleTranslation } from '@/modules/localization';

export function NotFound() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('conversation');

  return (
    <div className='flex flex-col items-center justify-center h-screen w-full gap-4'>
      <div className='w-fit flex flex-col items-center'>
        <ChatConversationEmptyState title={t('notFound.title')} description={t('notFound.description')} />
        <Button variant='outline' onClick={() => navigate('/')} className='w-fit'>
          <ArrowLeft className='mr-2 h-4 w-4' />
          {t('notFound.back')}
        </Button>
      </div>
    </div>
  );
}
