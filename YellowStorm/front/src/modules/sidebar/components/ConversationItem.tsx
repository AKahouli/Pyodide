import { useState, useCallback, memo } from 'react';
import { NavLink } from 'react-router-dom';
import { MoreHorizontal, Pencil, Share, Trash2, Users } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuAction } from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RenameDialog } from '@/modules/conversation/components/RenameDialog';
import { DeleteConversationDialog } from '@/modules/conversation/components/DeleteConversationDialog';
import { useConversationStore } from '@/modules/conversation/store';
import { useTypewriter } from '@/modules/conversation/hooks/useTypewriter';
import { useModuleTranslation } from '@/modules/localization';

export interface ConversationItemProps {
  id: string;
  title: string;
  isGroup?: boolean;
  mentionCount?: number;
  onRename?: (newTitle: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onShare?: () => void;
}

export const ConversationItem = memo(function ConversationItem({ id, title, isGroup, mentionCount, onRename, onDelete, onShare }: ConversationItemProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const typewriterConversationId = useConversationStore((s) => s.typewriterConversationId);
  const typewriterName = useConversationStore((s) => s.typewriterName);
  const clearTypewriter = useConversationStore((s) => s.clearTypewriter);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);

  // Typewriter effect for newly generated names
  const isTypewriting = typewriterConversationId === id;
  const typewriterText = useTypewriter(isTypewriting ? typewriterName : null, 30, clearTypewriter);

  const displayTitle = isTypewriting && typewriterText ? typewriterText : title;
  const { t } = useModuleTranslation('sidebar');

  const handleRenameClick = useCallback(() => {
    setRenameOpen(true);
  }, []);

  const handleDeleteClick = useCallback(() => {
    setDeleteOpen(true);
  }, []);

  const handleShareClick = useCallback(() => {
    onShare?.();
  }, [onShare]);

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip={displayTitle} isActive={currentConversationId === id}>
          <NavLink to={`/conversation/${id}`}>
            {isGroup && (
              <div className="relative">
                <Users className="h-4 w-4" />
                {mentionCount && mentionCount > 0 ? (
                  <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-destructive-foreground">
                    {mentionCount > 9 ? '9+' : mentionCount}
                  </span>
                ) : null}
              </div>
            )}
            <span className="truncate">{displayTitle}</span>
          </NavLink>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover>
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
            <DropdownMenuItem onClick={handleDeleteClick} className='cursor-pointer text-destructive'>
              <Trash2 className='mr-2 h-4 w-4' />
              {t('conversations.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      {onRename && <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} currentTitle={title} onRename={onRename} />}

      {onDelete && <DeleteConversationDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={onDelete} title={title} />}
    </>
  );
});
