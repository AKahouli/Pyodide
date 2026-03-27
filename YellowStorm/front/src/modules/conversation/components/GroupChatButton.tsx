import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { CreateGroupConversationDialog } from './CreateGroupConversationDialog';

export function GroupChatButton() {
  const { t } = useModuleTranslation('conversation');
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div className='w-full max-w-3xl px-4 mt-4 flex justify-end'>
        <Button variant='outline' type='button' onClick={() => setIsOpen(true)}>
          {t('newConversation.startGroupChat')}
        </Button>
      </div>
      <CreateGroupConversationDialog open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}

