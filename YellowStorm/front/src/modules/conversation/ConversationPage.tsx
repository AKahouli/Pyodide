import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useConversationStore, useCurrentConversation, useConversationLoading } from './store';
import { ConversationHeader } from './components/ConversationHeader';
import { ConversationContent } from './components/ConversationContent';
import { ConversationInput } from './components/ConversationInput';
import { StreamErrorDialog } from './components/StreamErrorDialog';
import { NotFound } from './components/NotFound';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { useFileViewerStore, FileViewerSidebar } from '@/modules/file-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { GroupConversationPage } from './GroupConversationPage';

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const setCurrentConversation = useConversationStore((s) => s.setCurrentConversation);
  const fetchMessages = useConversationStore((s) => s.fetchMessages);
  const clearMessages = useConversationStore((s) => s.clearMessages);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const currentConversation = useCurrentConversation();
  const conversationLoading = useConversationLoading();

  const isGroup = !!currentConversation?.groupMeta?.isGroup;

  // Auto-switch to floating when leaving conversation page
  useEffect(() => {
    return () => {
      const state = useFileViewerStore.getState();
      if (state.displayMode === 'sidebar' && state.mode !== 'closed') {
        state.setDisplayMode('floating');
      }
    };
  }, []);

  // Auto-switch sidebar → floating when viewport shrinks below mobile breakpoint
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        const state = useFileViewerStore.getState();
        if (state.displayMode === 'sidebar' && state.mode !== 'closed') {
          state.setDisplayMode('floating');
        }
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (id) {
      setCurrentConversation(id);
    }
  }, [id, setCurrentConversation]);

  // Depend on conversation id only — object patches (e.g. taggedAgentIds) must not re-fetch.
  useEffect(() => {
    if (id && currentConversationId === id) {
      fetchMessages(id);
    }
  }, [id, currentConversationId, fetchMessages]);

  useEffect(() => {
    return () => {
      clearMessages();
    };
  }, [clearMessages]);

  const { t } = useModuleTranslation('conversation');

  // Show loading if we haven't finished loading, or if the id changed and we haven't started loading yet
  if (conversationLoading || (id && currentConversationId !== id)) {
    return (
      <div className='flex items-center justify-center flex-1'>
        <Shimmer as='h3' className='text-md pb-4' duration={1} spread={2}>
          {t('page.loading')}
        </Shimmer>
      </div>
    );
  }

  if (!currentConversation) {
    return <NotFound />;
  }
 
  if (isGroup) {
    return <GroupConversationPage id={id!} conversation={currentConversation} />;
  }
 
  return (
    <div className='relative flex flex-1 min-h-0 w-full'>
      <div className='flex flex-col flex-1 min-w-0 max-w-4xl mx-auto'>
        <ConversationHeader />
        <ConversationContent />
        <ConversationInput conversationId={id!} />
        <StreamErrorDialog />
      </div>
      <FileViewerSidebar />
    </div>
  );
}