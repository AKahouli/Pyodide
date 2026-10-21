import { useCallback, useMemo, useState, memo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ArrowRight, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore } from '@/modules/conversation/store';
import { useConversationV2PointersStore, useConversationV2Store } from '@/modules/conversation-v2/store';
// Leaf imports: avoid the project barrel (ProjectPage graph cycles back here).
import { useProjectStore } from '@/modules/project/store';
import { CreateProjectDialog } from '@/modules/project/components/CreateProjectDialog';
import { ShareDialog } from '@/modules/conversation/components/ShareDialog';
import { ConversationItem } from './ConversationItem';
import { decodeConversationDrag, hasConversationDrag } from './drag-types';
import { groupByDay, disambiguateTitles, type HistoryRow } from './chatGroups';
import { conversationPinKey, usePinnedConversations } from '../hooks/usePinnedConversations';

/**
 * Day-grouped chat list shared by the sidebar rail and the All chats page.
 * Rows arrive newest-first; grouping, title disambiguation and row actions live here.
 */
export const RecentChats = memo(function RecentChats({
  rows,
  loading,
  showAllChatsLink = false,
  compact = false,
  includeSavedPins = false,
}: {
  rows: HistoryRow[];
  loading?: boolean;
  showAllChatsLink?: boolean;
  compact?: boolean;
  includeSavedPins?: boolean;
}) {
  const { t } = useModuleTranslation('sidebar');
  const navigate = useNavigate();
  const { pins, togglePin, unpin, renamePin } = usePinnedConversations();
  const pinnedKeys = useMemo(() => new Set(pins.map(conversationPinKey)), [pins]);

  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const moveConversationToProject = useConversationStore((s) => s.moveConversationToProject);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  // Live stream OR awaiting-first-chunk (agent activity before the first token).
  const v1ActiveConversationId = useConversationStore((s) =>
    s.isStreaming ? s.streamingConversationId : s.isAwaitingFirstChunk ? s.awaitingConversationId : null,
  );
  // Shallow-stable id arrays: the stores replace the cache Map on every background
  // stream chunk, so subscribing by Map reference would re-render the whole list at token rate.
  const v1BackgroundStreamingIds = useConversationStore(useShallow((s) => Array.from(s.streamingStateCache.keys())));
  const v2BackgroundStreamingIds = useConversationV2Store(
    useShallow((s) => Array.from(s.streamingStateCache).filter(([, slice]) => slice.streaming).map(([id]) => id)),
  );
  const renameV2 = useConversationV2PointersStore((s) => s.rename);
  const removeV2 = useConversationV2PointersStore((s) => s.remove);
  const currentV2SessionId = useConversationV2Store((s) => s.sessionId);
  const v2Streaming = useConversationV2Store((s) => s.streaming);

  const createProject = useProjectStore((s) => s.createProject);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareConversation, setShareConversation] = useState<{ id: string; title: string } | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [pendingMoveConvId, setPendingMoveConvId] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (id: string) => {
      const wasCurrentConversation = currentConversationId === id;
      await deleteConversation(id);
      unpin({ kind: 'v1', id });
      if (wasCurrentConversation) navigate('/');
    },
    [currentConversationId, deleteConversation, navigate, unpin],
  );

  const handleRename = useCallback(
    async (id: string, newTitle: string) => {
      await updateConversation(id, { title: newTitle });
      renamePin({ kind: 'v1', id }, newTitle);
    },
    [updateConversation, renamePin],
  );

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

  const handleDeleteV2 = useCallback(
    async (sessionId: string) => {
      const wasCurrent = currentV2SessionId === sessionId;
      await removeV2(sessionId);
      unpin({ kind: 'v2', id: sessionId });
      if (wasCurrent) navigate('/studio');
    },
    [currentV2SessionId, removeV2, navigate, unpin],
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

  const displayedGroups = useMemo(() => {
    const live = new Map(rows.map((row) => [conversationPinKey(row), row]));
    const pinned = disambiguateTitles(pins.flatMap((pin) => {
      const row = live.get(conversationPinKey(pin));
      return row ? [row] : includeSavedPins ? [pin] : [];
    }));
    const recent = disambiguateTitles(rows.filter((row) => !pinnedKeys.has(conversationPinKey(row))));
    return [
      ...(pinned.length ? [{ bucket: 'pinned' as const, rows: pinned }] : []),
      ...(compact ? [{ bucket: 'today' as const, rows: recent }] : groupByDay(recent)),
    ];
  }, [rows, pins, pinnedKeys, compact, includeSavedPins]);
  const dayLabels = useMemo(
    () => ({
      today: t('recentChats.today'),
      yesterday: t('recentChats.yesterday'),
      last7: t('recentChats.last7'),
      older: t('recentChats.older'),
      pinned: t('recentChats.pinned'),
    }),
    [t],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      setIsOver(false);
      const payload = decodeConversationDrag(
        e.dataTransfer.getData('application/x-yellowstorm-conversation'),
      );
      if (!payload?.sourceProjectId) return;
      e.preventDefault();
      handleHistoryDrop(payload.conversationId, payload.sourceProjectId);
    },
    [handleHistoryDrop],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasConversationDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the zone itself, not a child.
    if (e.currentTarget === e.target) setIsOver(false);
  }, []);

  return (
    <div
      data-history-list
      className={cn(!compact && 'min-h-full', isOver && 'rounded-md bg-primary/5 ring-1 ring-primary/40')}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {displayedGroups.map(({ bucket, rows: groupRows }) => (
        <div key={bucket}>
          {groupRows.length > 0 && (!compact || pinnedKeys.size > 0) && <div className='sticky top-0 z-10 bg-sidebar px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            {compact && bucket !== 'pinned' ? t('recentChats.label') : dayLabels[bucket]}
          </div>}
          <SidebarMenu className='pe-1'>
            {groupRows.map((row) =>
              row.kind === 'v2' ? (
                <ConversationItem
                  key={`v2-${row.id}`}
                  id={row.id}
                  pinned={pinnedKeys.has(conversationPinKey(row))}
                  onTogglePin={() => togglePin(row)}
                  title={row.displayTitle}
                  to={row.to}
                  icon={<Sparkles className='h-4 w-4 text-primary' />}
                  isActive={currentV2SessionId === row.id}
                  streaming={(v2Streaming && currentV2SessionId === row.id) || v2BackgroundStreamingIds.includes(row.id)}
                  draggable={false}
                  onRename={async (newTitle) => {
                    await renameV2(row.id, newTitle);
                    renamePin(row, newTitle);
                  }}
                  onDelete={() => handleDeleteV2(row.id)}
                />
              ) : (
                <ConversationItem
                  key={row.id}
                  id={row.id}
                  pinned={pinnedKeys.has(conversationPinKey(row))}
                  onTogglePin={() => togglePin(row)}
                  title={row.displayTitle}
                  projectId={row.conv?.projectId ?? null}
                  isGroup={row.conv?.isGroup}
                  isShared={row.conv?.isShared}
                  mentionCount={row.conv?.unseenMentionCount}
                  streaming={v1ActiveConversationId === row.id || v1BackgroundStreamingIds.includes(row.id)}
                  onRename={(newTitle) => handleRename(row.id, newTitle)}
                  onDelete={() => handleDelete(row.id)}
                  onShare={() => handleShare(row.id, row.title)}
                  onMove={(targetProjectId) => moveConversationToProject(row.id, targetProjectId)}
                  onNewProject={() => handleNewProjectFromMove(row.id)}
                />
              ),
            )}
          </SidebarMenu>
        </div>
      ))}

      {loading && (
        <SidebarMenu>
          <SidebarMenuSkeleton index={0} />
          <SidebarMenuSkeleton index={1} />
          <SidebarMenuSkeleton index={2} />
        </SidebarMenu>
      )}

      {!loading && displayedGroups.every((group) => group.rows.length === 0) && (
        <p className='px-2 py-1 text-xs text-muted-foreground'>{t('recentChats.empty')}</p>
      )}

      {showAllChatsLink && (
        <SidebarMenu className='sticky bottom-0 bg-sidebar pt-1'>
          <SidebarMenuItem>
            <NavLink
              to='/chats'
              className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            >
              <span className='truncate'>{t('recentChats.allChats')}</span>
              <ArrowRight aria-hidden='true' className='ms-auto h-4 w-4 shrink-0' />
            </NavLink>
          </SidebarMenuItem>
        </SidebarMenu>
      )}

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
    </div>
  );
});
