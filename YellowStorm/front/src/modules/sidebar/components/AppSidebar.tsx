import { useEffect, useMemo, useState, useCallback, memo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bot, History, LayoutGrid } from 'lucide-react';
import { ChatBubbleIcon } from '@radix-ui/react-icons';
import { toast } from 'sonner';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ProfileMenu } from '@/components/ui/profile-menu';
import { ModeToggle } from '@/components/mode-toggle';
import { AppLogo } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  useConversationStore,
  useHistoryConversations,
  useConversationsLoading,
  useConversationsHasMore,
  useHistoryPanelOpen,
  useToggleHistoryPanel,
  DEFAULT_CONVERSATIONS_LIMIT,
} from '@/modules/conversation/store';
import {
  useConversationV2PointersStore,
  useConversationV2Store,
} from '@/modules/conversation-v2/store';
import { WorkspaceButton } from '@/modules/workspace';
import { AgentButton } from '@/modules/agent';
import { TeamButton } from '@/modules/team';
import { GroupsButton } from '@/modules/groups';
import { PlaybookButton } from '@/modules/playbook/components/PlaybookButton';
import { WorkyButton } from '@/modules/worky/components/WorkyButton';
import { GovernanceButton } from '@/modules/governance';
import { ConnectedAppButton } from '@/modules/connected-app';
import { AppMarketplaceButton } from '@/modules/app-marketplace';
import { AdminButton, DEFAULT_FEATURE_VISIBILITY, getFeatureVisibility } from '@/modules/admin';
import type { FeatureVisibility } from '@/modules/admin';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import { useModuleTranslation } from '@/modules/localization';
import { useProjectStore } from '@/modules/project';
import { CreateProjectDialog } from '@/modules/project';

import { ShareDialog } from '@/modules/conversation/components/ShareDialog';
import { ConversationItem } from './ConversationItem';
import { ProjectsSection } from './ProjectsSection';
import { useAutoCollapse } from '../hooks/useAutoCollapse';
import { useAuth } from '@/modules/auth';
import { decodeConversationDrag, hasConversationDrag } from './drag-types';

function HistoryDropZone({
  children,
  className,
  onDropConversation,
}: {
  children: React.ReactNode;
  className?: string;
  onDropConversation: (conversationId: string, sourceProjectId: string | null) => void;
}) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasConversationDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're leaving the zone itself, not a child
    if (e.currentTarget === e.target) {
      setIsOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsOver(false);
      const payload = decodeConversationDrag(
        e.dataTransfer.getData('application/x-yellowstorm-conversation'),
      );
      if (!payload) return;
      e.preventDefault();
      // History drop is only meaningful when the conversation comes from a project
      if (!payload.sourceProjectId) return;
      onDropConversation(payload.conversationId, payload.sourceProjectId);
    },
    [onDropConversation],
  );

  return (
    <div
      className={cn(className, isOver && 'rounded-md ring-1 ring-primary/40 bg-primary/5')}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

export const AppSidebar = memo(function AppSidebar() {
  const { state, toggleSidebar } = useAutoCollapse();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useModuleTranslation('sidebar');
  const { user } = useAuth();
  const { hasAnyPermission } = usePermissions();
  const canOpenGovernance = hasAnyPermission(['governance.read', 'governance.*', '*']);
  const [featureVisibility, setFeatureVisibility] = useState<FeatureVisibility>(DEFAULT_FEATURE_VISIBILITY);

  useEffect(() => {
    let active = true;
    getFeatureVisibility()
      .then((value) => {
        if (active) setFeatureVisibility(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const historyConversations = useHistoryConversations();
  const conversationsLoading = useConversationsLoading();
  const hasMore = useConversationsHasMore();
  const historyPanelOpen = useHistoryPanelOpen();
  const toggleHistoryPanel = useToggleHistoryPanel();
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const moveConversationToProject = useConversationStore((s) => s.moveConversationToProject);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);

  // conversation-v2 sessions live in their own store; merge them into history.
  const v2Pointers = useConversationV2PointersStore((s) => s.items);
  const fetchV2Pointers = useConversationV2PointersStore((s) => s.fetch);
  const renameV2 = useConversationV2PointersStore((s) => s.rename);
  const removeV2 = useConversationV2PointersStore((s) => s.remove);
  const currentV2SessionId = useConversationV2Store((s) => s.sessionId);

  const createProject = useProjectStore((s) => s.createProject);

  const [historySearch, setHistorySearch] = useState('');
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [pendingMoveConvId, setPendingMoveConvId] = useState<string | null>(null);

  useEffect(() => {
    fetchConversations({ reset: true, limit: DEFAULT_CONVERSATIONS_LIMIT });
    fetchV2Pointers({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = historySearch.trim();
      fetchConversations({
        reset: true,
        limit: DEFAULT_CONVERSATIONS_LIMIT,
        search: trimmed || undefined,
      });
      fetchV2Pointers({ reset: true, q: trimmed || undefined });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historySearch]);

  const handleLoadMore = useCallback(() => {
    const trimmed = historySearch.trim();
    fetchConversations({
      limit: DEFAULT_CONVERSATIONS_LIMIT,
      search: trimmed || undefined,
    });
  }, [fetchConversations, historySearch]);

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

  const handleNewProjectFromMove = useCallback((conversationId: string) => {
    setPendingMoveConvId(conversationId);
    setCreateProjectOpen(true);
  }, []);

  const handleProjectCreatedForMove = useCallback(
    async (name: string) => {
      const project = await createProject(name);
      if (pendingMoveConvId) {
        await moveConversationToProject(pendingMoveConvId, project.id);
        setPendingMoveConvId(null);
      }
    },
    [createProject, moveConversationToProject, pendingMoveConvId],
  );

  const handleHistoryDrop = useCallback(
    async (conversationId: string, _sourceProjectId: string | null) => {
      try {
        await moveConversationToProject(conversationId, null);
        toast.success(t('projects.toasts.conversationMoved'));
      } catch {
        // store handles error toast
      }
    },
    [moveConversationToProject, t],
  );

  const handleDeleteV2 = useCallback(
    async (sessionId: string) => {
      const wasCurrent = currentV2SessionId === sessionId;
      await removeV2(sessionId);
      if (wasCurrent) {
        navigate('/conversation-v2');
      }
    },
    [currentV2SessionId, removeV2, navigate],
  );

  // Merge v1 conversations and v2 sessions into a single, recency-sorted list.
  type HistoryRow =
    | { kind: 'v1'; id: string; sortTime: number; conv: (typeof historyConversations)[number] }
    | { kind: 'v2'; id: string; sortTime: number; ptr: (typeof v2Pointers)[number] };

  const mergedHistory = useMemo<HistoryRow[]>(() => {
    const v1Rows: HistoryRow[] = historyConversations.map((conv) => ({
      kind: 'v1',
      id: conv.id,
      sortTime: new Date(conv.updatedAt || conv.lastMessageAt).getTime(),
      conv,
    }));
    const v2Rows: HistoryRow[] = v2Pointers.map((ptr) => ({
      kind: 'v2',
      id: ptr.sessionId,
      sortTime: new Date(ptr.lastEventAt).getTime(),
      ptr,
    }));
    return [...v1Rows, ...v2Rows].sort((a, b) => b.sortTime - a.sortTime);
  }, [historyConversations, v2Pointers]);

  return (
    <Sidebar collapsible='icon' className='shrink-0 z-30'>
      <SidebarHeader className='pt-8 gap-0 duration-500 ease-linear '>
        <NavLink
          to='/'
          className='flex items-center h-12 mb-4 overflow-hidden duration-500 ease-linear group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0'
        >
          <AppLogo className='h-12 shrink-0' />
        </NavLink>
      </SidebarHeader>

      <SidebarContent className='my-3 w-full min-h-0 overflow-y-auto overscroll-y-contain'>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={t('actions.platformOverview.tooltip')}
                isActive={location.pathname === '/platform'}
              >
                <NavLink to='/platform'>
                  <LayoutGrid />
                  <span>{t('actions.platformOverview.label')}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {featureVisibility.conversation && <SidebarMenuItem>
              <SidebarMenuButton tooltip={t('actions.newChat.tooltip')} onClick={() => navigate('/')}>
                <ChatBubbleIcon />
                <span>{t('actions.newChat.label')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>}

            {featureVisibility.workspace && <WorkspaceButton />}

            {featureVisibility.agents && <AgentButton />}

            {featureVisibility.governance && canOpenGovernance && <GovernanceButton />}

            <TeamButton />

            <GroupsButton />

            {featureVisibility.playbook && <PlaybookButton />}

            {featureVisibility.worky && <WorkyButton />}

            <ConnectedAppButton />

            {featureVisibility.appMarketplace && <AppMarketplaceButton />}

            <AdminButton />
          </SidebarMenu>
        </SidebarGroup>

        {state !== 'collapsed' && <ProjectsSection />}

        <SidebarGroup>
          <Collapsible
            open={historyPanelOpen && state !== 'collapsed'}
            onOpenChange={() => {
              if (state === 'collapsed') {
                toggleSidebar();
              }
              toggleHistoryPanel();
            }}
          >
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
            <CollapsibleContent>
              {(mergedHistory.length > 0 || historySearch.trim().length > 0) && (
                <div className='sticky top-0 z-10 bg-sidebar px-2 pb-2'>
                  <Input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder={t('history.searchPlaceholder')}
                    className='h-8 text-xs'
                  />
                </div>
              )}
              <HistoryDropZone
                className='pr-1'
                onDropConversation={handleHistoryDrop}
              >
                <SidebarMenu>
                  {mergedHistory.map((row) => {
                    if (row.kind === 'v2') {
                      return (
                        <ConversationItem
                          key={`v2-${row.ptr.sessionId}`}
                          id={row.ptr.sessionId}
                          title={row.ptr.title || t('history.untitled')}
                          to={`/conversation-v2/${row.ptr.sessionId}`}
                          icon={<Bot className='h-4 w-4' />}
                          isActive={currentV2SessionId === row.ptr.sessionId}
                          draggable={false}
                          onRename={(newTitle) => renameV2(row.ptr.sessionId, newTitle)}
                          onDelete={() => handleDeleteV2(row.ptr.sessionId)}
                        />
                      );
                    }

                    const conv = row.conv;
                    const mentionCount =
                      conv.groupMeta?.members?.find((m) => m.userId === user?.id)?.mentions?.filter((m) => !m.seenAt).length || 0;

                    return (
                      <ConversationItem
                        key={conv.id}
                        id={conv.id}
                        title={conv.title}
                        projectId={conv.projectId ?? null}
                        isGroup={!!conv.groupMeta?.isGroup}
                        mentionCount={mentionCount}
                        onRename={(newTitle) => handleRename(conv.id, newTitle)}
                        onDelete={() => handleDelete(conv.id)}
                        onShare={() => handleShare(conv.id, conv.title)}
                        onMove={(targetProjectId) => moveConversationToProject(conv.id, targetProjectId)}
                        onNewProject={() => handleNewProjectFromMove(conv.id)}
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
                  {!conversationsLoading && mergedHistory.length === 0 && (
                    <li className='px-2 py-1 text-xs text-muted-foreground'>{t('history.empty')}</li>
                  )}
                  {hasMore && !conversationsLoading && (
                    <SidebarMenuItem>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='w-full text-xs text-muted-foreground text-start bg-transparent hover:bg-transparent'
                        onClick={handleLoadMore}
                      >
                        <p className='w-full text-xs text-muted-foreground text-start underline cursor-pointer'>
                          {t('history.showMore')}
                        </p>
                      </Button>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </HistoryDropZone>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className='grid grid-cols-[1fr_auto_auto] items-center gap-1 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:justify-items-center'>
        <ProfileMenu />
        <ModeToggle />
        <SidebarTrigger />
      </SidebarFooter>

      {shareConversation && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          conversationId={shareConversation.id}
          conversationTitle={shareConversation.title}
        />
      )}

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={(open) => {
          setCreateProjectOpen(open);
          if (!open) setPendingMoveConvId(null);
        }}
        onCreate={handleProjectCreatedForMove}
      />
      <SidebarRail />
    </Sidebar>
  );
});
