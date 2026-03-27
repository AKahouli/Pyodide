import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConversationStore } from './store';
import { ConversationHeader } from './components/ConversationHeader';
import { GroupConversationContent } from './components/GroupConversationContent';
import { ConversationInput } from './components/ConversationInput';
import { StreamErrorDialog } from './components/StreamErrorDialog';
import { FileViewerSidebar } from '@/modules/file-viewer';
import { JoinConversationLanding } from './components/JoinConversationLanding';
import { joinConversation } from './api';
import { toast } from 'sonner';
import { useAuth } from '@/modules/auth';
import type { Conversation } from './types';
import { useModuleTranslation } from '@/modules/localization';

interface GroupConversationPageProps {
  id: string;
  conversation: Conversation;
}

export function GroupConversationPage({ id, conversation }: GroupConversationPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [showLanding, setShowLanding] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  
  const setCurrentConversation = useConversationStore((s) => s.setCurrentConversation);
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const fetchMessages = useConversationStore((s) => s.fetchMessages);
 
  const loadingJoin = searchParams.get('join') === 'true';

  const isOwner = !!conversation.groupMeta?.members.some(
    (m) => m.status === 'owner' && String(m.userId) === String(user?.id)
  );
  
  const isMember = !!conversation.groupMeta?.members.some(
    (m) => String(m.userId) === String(user?.id)
  );

  useEffect(() => {
    if (id && conversation && !authLoading) {
      if (isMember || isOwner) {
        fetchMessages(id);
      }
    }
  }, [id, conversation, isMember, isOwner, fetchMessages, authLoading]);

  const handleJoin = async () => {
    setIsJoining(true);
    try {
      // Officially join the conversation in the backend
      await joinConversation(id);
      
      // Refresh conversation data in store to reflect new member status
      await setCurrentConversation(id);
      
      // Refresh the sidebar list so the conversation appears in history
      await fetchConversations({ reset: true });
      
      setShowLanding(false);
    } catch (error) {
      console.error('Failed to join conversation:', error);
      toast.error('Failed to join conversation. Please try again.');
    } finally {
      setIsJoining(false);
    }
  };
 
  const shouldShowLanding = (!isMember || (loadingJoin && !isOwner)) && showLanding;

  if (!authLoading && shouldShowLanding) {
    return (
      <div className='flex flex-1 flex-col'>
        <JoinConversationLanding 
          conversation={conversation} 
          onJoin={handleJoin} 
          loading={isJoining}
        />
      </div>
    );
  }
 
  return (
    <div className='relative flex flex-1 min-h-0 w-full'>
      <div className='flex flex-col flex-1 min-w-0 max-w-4xl mx-auto'>
        <ConversationHeader />
        <GroupConversationContent />
        <ConversationInput conversationId={id} />
        <StreamErrorDialog />
      </div>
      <FileViewerSidebar />
    </div>
  );
}
