import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Library, MoreHorizontal, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import {
  ConversationV2SessionPermissions,
  hasConversationV2SessionPermission,
  type ConversationV2SessionPermission,
} from '../session-permissions';
import { useConversationV2Store } from '../store';
import { useTypewriter } from '../hooks/useTypewriter';
import { useConversationV2Translation } from '../translation';
import { RenameDialog } from './RenameDialog';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { WorkspaceManagerSheet } from './WorkspaceManagerSheet';

interface ConversationV2HeaderProps {
  readOnly?: boolean;
  permissions?: ConversationV2SessionPermission[];
}

export function ConversationV2Header({ readOnly = false, permissions = [] }: ConversationV2HeaderProps) {
  const navigate = useNavigate();
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const title = useConversationV2Store((s) => s.title);
  const workspaceIds = useConversationV2Store((s) => s.workspaceIds);
  const systemWorkspaceId = useConversationV2Store((s) => s.systemWorkspaceId);
  const setFilesSheetOpen = useConversationV2Store((s) => s.setFilesSheetOpen);
  const renameCurrent = useConversationV2Store((s) => s.renameCurrent);
  const deleteCurrent = useConversationV2Store((s) => s.deleteCurrent);
  const typewriterSessionId = useConversationV2Store((s) => s.typewriterSessionId);
  const typewriterName = useConversationV2Store((s) => s.typewriterName);
  const clearTypewriter = useConversationV2Store((s) => s.clearTypewriter);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);

  const { t } = useConversationV2Translation();

  const isTypewriting = !!sessionId && typewriterSessionId === sessionId;
  const typed = useTypewriter(isTypewriting ? typewriterName : null, 30, clearTypewriter);

  const displayedTitle =
    isTypewriting && typed ? typed : title && title.length > 0 ? title : t('page.newChat');

  const canManageWorkspaces = hasConversationV2SessionPermission(
    permissions,
    ConversationV2SessionPermissions.SESSION_WRITE,
  );
  const canBrowseFiles = hasConversationV2SessionPermission(
    permissions,
    ConversationV2SessionPermissions.WORKSPACE_DOCUMENTS_READ,
  );
  const canRename = hasConversationV2SessionPermission(
    permissions,
    ConversationV2SessionPermissions.SESSION_WRITE,
  );
  const canDelete = hasConversationV2SessionPermission(
    permissions,
    ConversationV2SessionPermissions.SESSION_DELETE,
  );

  const handleRename = async (newTitle: string) => {
    try {
      await renameCurrent(newTitle);
    } catch {
      toast.error(t('toasts.rename.error'));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteCurrent();
      navigate('/');
    } catch {
      toast.error(t('toasts.delete.error'));
    }
  };

  if (!sessionId) return null;

  return (
    <>
      <div className='sticky top-0 z-10 flex items-center gap-3 p-4 border-b border-border/50 bg-background/80 backdrop-blur-sm'>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => navigate('/')}
          className='shrink-0'
          aria-label={t('header.back')}
        >
          <ArrowLeft className='h-4 w-4' />
        </Button>
        <h1 className='flex-1 truncate text-lg font-medium'>{displayedTitle}</h1>
        {readOnly && (
          <Badge variant='secondary' className='shrink-0'>
            {t('header.readOnly')}
          </Badge>
        )}

        <div className='flex items-center gap-1'>
          {canManageWorkspaces && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => setWorkspaceSheetOpen(true)}
                    className='shrink-0'
                    aria-label={t('header.tooltips.workspaces')}
                  >
                    <Library className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('header.tooltips.workspaces')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {canBrowseFiles && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => setFilesSheetOpen(true)}
                    disabled={!systemWorkspaceId}
                    className='shrink-0'
                    aria-label={t('header.tooltips.files')}
                    title={!systemWorkspaceId ? t('files.unavailable') : undefined}
                  >
                    <Paperclip className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('header.tooltips.files')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {(canRename || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='shrink-0'
                  aria-label={t('header.actions.more')}
                >
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {canRename && (
                  <DropdownMenuItem onClick={() => setRenameOpen(true)} className='cursor-pointer'>
                    <Pencil className='mr-2 h-4 w-4' />
                    {t('header.actions.rename')}
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    onClick={() => setDeleteOpen(true)}
                    className='cursor-pointer text-destructive focus:text-destructive'
                  >
                    <Trash2 className='mr-2 h-4 w-4' />
                    {t('header.actions.delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {canRename && (
        <RenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          currentTitle={title ?? ''}
          onRename={handleRename}
        />
      )}

      {canDelete && (
        <DeleteConversationDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          title={title ?? undefined}
        />
      )}

      {canManageWorkspaces && (
        <WorkspaceManagerSheet
          open={workspaceSheetOpen}
          onOpenChange={setWorkspaceSheetOpen}
          sessionId={sessionId}
          workspaceIds={workspaceIds}
        />
      )}
    </>
  );
}
