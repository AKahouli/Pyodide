import { useEffect, useState, useCallback, memo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Folder, History } from 'lucide-react';
import { ChatBubbleIcon } from '@radix-ui/react-icons';

import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ProfileMenu } from '@/components/ui/profile-menu';
import { AppLogo } from '@/components/icons';
import { useConversationStore, useConversations, useConversationsLoading, useConversationsHasMore, useHistoryPanelOpen, useToggleHistoryPanel, DEFAULT_CONVERSATIONS_LIMIT } from '@/modules/conversation/store';
import { WorkspaceButton } from '@/modules/workspace';
import { AgentButton } from '@/modules/agent';
import { PlaybookButton } from '@/modules/playbook/components/PlaybookButton';
import { ConnectedAppButton } from '@/modules/connected-app';
import { AdminButton } from '@/modules/admin';
import { useModuleTranslation } from '@/modules/localization';

import { ShareDialog } from '@/modules/conversation/components/ShareDialog';
import { ConversationItem } from './ConversationItem';
import { useAutoCollapse } from '../hooks/useAutoCollapse';
import { useAuth } from '@/modules/auth';

export const AppSidebar = memo(function AppSidebar() {
  const { state, toggleSidebar } = useAutoCollapse();
  const navigate = useNavigate();
  const { t } = useModuleTranslation('sidebar');
  const { user } = useAuth();

  const conversations = useConversations();
  const conversationsLoading = useConversationsLoading();
  const hasMore = useConversationsHasMore();
  const historyPanelOpen = useHistoryPanelOpen();
  const toggleHistoryPanel = useToggleHistoryPanel();
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);

  useEffect(() => {
    fetchConversations({ reset: true, limit: DEFAULT_CONVERSATIONS_LIMIT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMore = useCallback(() => {
    fetchConversations({ limit: DEFAULT_CONVERSATIONS_LIMIT });
  }, [fetchConversations]);

  const handleDelete = useCallback(
    async (id: string) => {
      const wasCurrentConversation = currentConversationId === id;
      await deleteConversation(id);
      if (wasCurrentConversation) {
        navigate('/');
      }
    },
    [currentConversationId, deleteConversation, navigate],
  );

  const handleRename = useCallback(
    async (id: string, newTitle: string) => {
      await updateConversation(id, { title: newTitle });
    },
    [updateConversation],
  );

  const [shareOpen, setShareOpen] = useState(false);
  const [shareConversation, setShareConversation] = useState<{ id: string; title: string } | null>(null);

  const handleShare = useCallback((id: string, title: string) => {
    setShareConversation({ id, title });
    setShareOpen(true);
  }, []);

  return (
    <Sidebar collapsible='icon' className='shrink-0 z-30'>
      <SidebarHeader className='pt-8 gap-0 duration-500 ease-linear '>
        <NavLink to='/' className='flex items-center h-12 mb-4 overflow-hidden  duration-500 ease-linear group-data-[collapsible=icon]:w-0  group-data-[collapsible=icon]:opacity-0'>
          <AppLogo className='h-12 shrink-0' />
        </NavLink>
        {/*
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Search"
              variant="outline"
              className="h-10 rounded-full font-normal text-muted-foreground group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:shadow-none group-data-[collapsible=icon]:bg-transparent"
              onClick={() => {
                if (state === 'collapsed') toggleSidebar();
              }}
            >
              <Search />
              <span>Search...</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>*/}
      </SidebarHeader>

      <SidebarContent className='my-3 w-full min-h-0 overflow-hidden'>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t('actions.newChat.tooltip')} onClick={() => navigate('/')}>
                <ChatBubbleIcon />
                <span>{t('actions.newChat.label')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t('actions.projects.tooltip')} disabled>
                <Folder />
                <span>{t('actions.projects.label')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <WorkspaceButton />

            <AgentButton />

            <PlaybookButton />

            <ConnectedAppButton />

            <AdminButton />
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className='flex-1 min-h-0 overflow-hidden'>
          <Collapsible
            className='flex flex-1 min-h-0 flex-col overflow-hidden'
            open={historyPanelOpen && state !== 'collapsed'}
            onOpenChange={(open) => {
              if (state === 'collapsed') {
                toggleSidebar();
              }
              toggleHistoryPanel();
            }}>
            <SidebarMenu>
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={t('history.tooltip')}>
                    <History />
                    <span>{t('history.label')}</span>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
              </SidebarMenuItem>
            </SidebarMenu>
            <CollapsibleContent className='flex min-h-0 flex-1 flex-col'>
              <div className='flex-1 min-h-0 overflow-y-auto pr-1'>
                <SidebarMenu>
                  {conversations.map((conv) => {
                    const mentionCount =
                      conv.groupMeta?.members?.find((m) => m.userId === user?.id)?.mentions?.filter((m) => !m.seenAt).length || 0;

                    return (
                      <ConversationItem
                        key={conv.id}
                        id={conv.id}
                        title={conv.title}
                        isGroup={!!conv.groupMeta?.isGroup}
                        mentionCount={mentionCount}
                        onRename={(newTitle) => handleRename(conv.id, newTitle)}
                        onDelete={() => handleDelete(conv.id)}
                        onShare={() => handleShare(conv.id, conv.title)}
                      />
                    );
                  })}
                  {conversationsLoading && (
                    <>
                      <SidebarMenuSkeleton index={0} />
                      <SidebarMenuSkeleton index={1} />
                      <SidebarMenuSkeleton index={2} />
                    </>
                  )}
                  {hasMore && !conversationsLoading && (
                    <SidebarMenuItem>
                      <Button variant='ghost' size='sm' className='w-full text-xs text-muted-foreground text-start bg-transparent hover:bg-transparent' onClick={handleLoadMore}>
                        <p className='w-full text-xs text-muted-foreground text-start underline cursor-pointer'>{t('history.showMore')}</p>
                      </Button>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className='grid grid-cols-[1fr_auto] items-center group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:justify-items-center'>
        <ProfileMenu />
        <SidebarTrigger />
      </SidebarFooter>

      {shareConversation && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} conversationId={shareConversation.id} conversationTitle={shareConversation.title} />}
    </Sidebar>
  );
});
