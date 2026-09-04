import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useConversationStore, useCurrentConversation, useConversationLoading } from './store';
import { ConversationHeader } from './components/ConversationHeader';
import { ConversationContent } from './components/ConversationContent';
import { ConversationInput } from './components/ConversationInput';
import { ConversationOutlineRail } from './components/outline/ConversationOutlineRail';
import { StreamErrorDialog } from './components/StreamErrorDialog';
import { NotFound } from './components/NotFound';
import { Skeleton } from '@/components/ui/skeleton';
import { useFileViewerStore, FileViewerSidebar } from '@/modules/file-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { GroupConversationPage } from './GroupConversationPage';
import { GovernedConversationBanner } from '@/modules/governance/components/consumer/GovernedConversationBanner';

let pendingMessageCleanup: ReturnType<typeof setTimeout> | null = null;
let mountedConversationPages = 0;

function ConversationLoadingShell({ label }: Readonly<{ label: string }>) {
  return (
    <div className='relative flex min-h-0 w-full flex-1' role='status' aria-label={label} aria-busy='true'>
      <div className='mx-auto flex min-w-0 max-w-6xl flex-1 flex-col'>
        <div data-loading-header className='flex h-[68px] shrink-0 items-center gap-3 border-b border-border/50 px-3 md:h-[60px] md:px-4' aria-hidden='true'>
          <Skeleton className='size-11 rounded-md motion-reduce:animate-none md:size-9' />
          <Skeleton className='h-5 w-36 motion-reduce:animate-none sm:w-52' />
          <div className='flex-1' />
          <Skeleton className='size-11 rounded-md motion-reduce:animate-none md:size-9' />
          <Skeleton className='size-11 rounded-md motion-reduce:animate-none md:size-9' />
        </div>
        <div className='flex min-h-0 flex-1 flex-col justify-end gap-4 px-2 py-6 md:px-4' aria-hidden='true'>
          <div className='space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-4'>
            <Skeleton className='h-4 w-4/5 motion-reduce:animate-none' />
            <Skeleton className='h-4 w-3/5 motion-reduce:animate-none' />
          </div>
          <div className='ml-auto w-3/5 space-y-2 rounded-2xl bg-primary/10 p-4'>
            <Skeleton className='h-4 w-full motion-reduce:animate-none' />
          </div>
        </div>
        <div className='shrink-0 px-4 pb-4' aria-hidden='true'>
          <div data-loading-composer className='h-28 rounded-xl border bg-background/70 p-3'>
            <Skeleton className='h-4 w-2/3 motion-reduce:animate-none' />
            <div className='mt-10 flex items-center gap-2'>
              <Skeleton className='size-9 motion-reduce:animate-none' />
              <Skeleton className='h-9 w-32 motion-reduce:animate-none' />
              <div className='flex-1' />
              <Skeleton className='size-9 motion-reduce:animate-none' />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const setCurrentConversation = useConversationStore((s) => s.setCurrentConversation);
  const fetchMessages = useConversationStore((s) => s.fetchMessages);
  const clearMessages = useConversationStore((s) => s.clearMessages);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const currentConversation = useCurrentConversation();
  const conversationLoading = useConversationLoading();
  const previousConversationIdRef = useRef(id);
  const viewerCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isGroup = !!currentConversation?.groupMeta?.isGroup;

  // Conversation previews must not follow the user into another conversation or route.
  useEffect(() => {
    if (viewerCleanupRef.current) {
      clearTimeout(viewerCleanupRef.current);
      viewerCleanupRef.current = null;
    }
    if (previousConversationIdRef.current !== id) {
      useFileViewerStore.getState().closeViewer();
      previousConversationIdRef.current = id;
    }

    return () => {
      // Defer unmount cleanup so StrictMode's immediate effect replay does not
      // close a viewer that belongs to the still-mounted conversation.
      viewerCleanupRef.current = setTimeout(() => {
        viewerCleanupRef.current = null;
        useFileViewerStore.getState().closeViewer();
      }, 0);
    };
  }, [id]);

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
      const state = useConversationStore.getState();
      if (state.currentConversationId !== id || state.currentConversation?.id !== id) {
        setCurrentConversation(id);
      }
    }
  }, [id, setCurrentConversation]);

  // Depend on conversation id only — object patches (e.g. taggedAgentIds) must not re-fetch.
  useEffect(() => {
    if (id && currentConversationId === id) {
      fetchMessages(id);
    }
  }, [id, currentConversationId, fetchMessages]);

  useEffect(() => {
    mountedConversationPages += 1;
    if (pendingMessageCleanup) {
      clearTimeout(pendingMessageCleanup);
      pendingMessageCleanup = null;
    }

    return () => {
      mountedConversationPages = Math.max(0, mountedConversationPages - 1);
      if (mountedConversationPages > 0) return;

      // StrictMode replays effects on mount. Defer cleanup so an immediate
      // remount can preserve the first message's active stream state.
      pendingMessageCleanup = setTimeout(() => {
        pendingMessageCleanup = null;
        if (mountedConversationPages === 0) clearMessages();
      }, 0);
    };
  }, [clearMessages]);

  const { t } = useModuleTranslation('conversation');

  // Show loading if we haven't finished loading, or if the id changed and we haven't started loading yet
  if (conversationLoading || (id && currentConversationId !== id)) {
    return <ConversationLoadingShell label={t('page.loading')} />;
  }

  if (!currentConversation) {
    return <NotFound />;
  }
 
  if (isGroup) {
    return <GroupConversationPage id={id!} conversation={currentConversation} />;
  }
 
  return (
    <div className='relative flex flex-1 min-h-0 w-full'>
      <ConversationOutlineRail />
      <div className='flex flex-col flex-1 min-w-0 max-w-6xl mx-auto'>
        <ConversationHeader />
        <GovernedConversationBanner conversation={currentConversation} />
        <ConversationContent />
        <ConversationInput conversationId={id!} />
        <StreamErrorDialog />
      </div>
      <FileViewerSidebar />
    </div>
  );
}
