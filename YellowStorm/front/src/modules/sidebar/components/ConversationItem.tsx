import { useState, useCallback, memo } from 'react';
import { NavLink } from 'react-router-dom';
import { MoreHorizontal, Pencil, Share, Trash2, Users, FolderPlus, FolderInput, FolderMinus, Plus } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuAction } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { RenameDialog } from '@/modules/conversation/components/RenameDialog';
import { DeleteConversationDialog } from '@/modules/conversation/components/DeleteConversationDialog';
import { useConversationStore } from '@/modules/conversation/store';
import { useTypewriter } from '@/modules/conversation/hooks/useTypewriter';
import { useModuleTranslation } from '@/modules/localization';
import { useProjects } from '@/modules/project';
import { CONVERSATION_DRAG_MIME, encodeConversationDrag } from './drag-types';

export interface ConversationItemProps {
  id: string;
  title: string;
  projectId?: string | null;
  isGroup?: boolean;
  mentionCount?: number;
  onRename?: (newTitle: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onShare?: () => void;
  onMove?: (projectId: string | null) => Promise<void>;
  onNewProject?: () => void;
}

export const ConversationItem = memo(function ConversationItem({
  id,
  title,
  projectId,
  isGroup,
  mentionCount,
  onRename,
  onDelete,
  onShare,
  onMove,
  onNewProject,
}: ConversationItemProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const typewriterConversationId = useConversationStore((s) => s.typewriterConversationId);
  const typewriterName = useConversationStore((s) => s.typewriterName);
  const clearTypewriter = useConversationStore((s) => s.clearTypewriter);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const projects = useProjects();

  // Typewriter effect for newly generated names
  const isTypewriting = typewriterConversationId === id;
  const typewriterText = useTypewriter(isTypewriting ? typewriterName : null, 30, clearTypewriter);

  const displayTitle = isTypewriting && typewriterText ? typewriterText : title;
  const { t } = useModuleTranslation('sidebar');

  const handleRenameClick = useCallback(() => setRenameOpen(true), []);
  const handleDeleteClick = useCallback(() => setDeleteOpen(true), []);
  const handleShareClick = useCallback(() => onShare?.(), [onShare]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLLIElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(
        CONVERSATION_DRAG_MIME,
        encodeConversationDrag({ conversationId: id, sourceProjectId: projectId ?? null }),
      );
      // Some browsers require text/plain to be set for the drag to work.
      e.dataTransfer.setData('text/plain', title);
    },
    [id, projectId, title],
  );

  return (
    <>
      <li
        data-slot='sidebar-menu-item'
        data-sidebar='menu-item'
        className='group/menu-item relative'
        draggable
        onDragStart={handleDragStart}
      >
        <SidebarMenuButton asChild tooltip={displayTitle} isActive={currentConversationId === id}>
          <NavLink to={`/conversation/${id}`} draggable={false}>
            {isGroup && (
              <div className='relative'>
                <Users className='h-4 w-4' />
                {mentionCount && mentionCount > 0 ? (
                  <span className='absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-destructive-foreground'>
                    {mentionCount > 9 ? '9+' : mentionCount}
                  </span>
                ) : null}
              </div>
            )}
            <span className='truncate'>{displayTitle}</span>
          </NavLink>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              draggable={false}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='right' align='start'>
            <DropdownMenuItem onClick={handleRenameClick} className='cursor-pointer'>
              <Pencil className='mr-2 h-4 w-4' />
              {t('conversations.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleShareClick} className='cursor-pointer'>
              <Share className='mr-2 h-4 w-4' />
              {t('conversations.share')}
            </DropdownMenuItem>
            {onMove && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className='cursor-pointer'>
                  <FolderInput className='mr-2 h-4 w-4' />
                  {t('conversations.moveToProject')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {onNewProject && (
                    <DropdownMenuItem
                      className='cursor-pointer'
                      onClick={() => onNewProject()}
                    >
                      <Plus className='mr-2 h-4 w-4' />
                      {t('conversations.newProject')}
                    </DropdownMenuItem>
                  )}
                  {onNewProject && projects.length > 0 && <DropdownMenuSeparator />}
                  {projects
                    .filter((p) => p.id !== projectId)
                    .map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        className='cursor-pointer'
                        onClick={() => onMove(p.id)}
                      >
                        <FolderPlus className='mr-2 h-4 w-4' />
                        <span className='truncate'>{p.name}</span>
                      </DropdownMenuItem>
                    ))}
                  {projectId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className='cursor-pointer' onClick={() => onMove(null)}>
                        <FolderMinus className='mr-2 h-4 w-4' />
                        {t('conversations.removeFromProject')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onClick={handleDeleteClick} className='cursor-pointer text-destructive'>
              <Trash2 className='mr-2 h-4 w-4' />
              {t('conversations.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>

      {onRename && <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} currentTitle={title} onRename={onRename} />}

      {onDelete && <DeleteConversationDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={onDelete} title={title} />}
    </>
  );
});
