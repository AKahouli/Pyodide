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
import { useConversationV2Store } from '../store';
import { useTypewriter } from '../hooks/useTypewriter';
import { useConversationV2Translation } from '../translation';
import { RenameDialog } from './RenameDialog';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { WorkspaceManagerSheet } from './WorkspaceManagerSheet';

export function ConversationV2Header() {
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
        <h1 className='flex-1 font-medium text-lg truncate'>{displayedTitle}</h1>

        <div className='flex items-center gap-1'>
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
              <DropdownMenuItem onClick={() => setRenameOpen(true)} className='cursor-pointer'>
                <Pencil className='mr-2 h-4 w-4' />
                {t('header.actions.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className='cursor-pointer text-destructive focus:text-destructive'
              >
                <Trash2 className='mr-2 h-4 w-4' />
                {t('header.actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentTitle={title ?? ''}
        onRename={handleRename}
      />

      <DeleteConversationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={title ?? undefined}
      />

      <WorkspaceManagerSheet
        open={workspaceSheetOpen}
        onOpenChange={setWorkspaceSheetOpen}
        sessionId={sessionId}
        workspaceIds={workspaceIds}
      />
    </>
  );
}
