import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowLeft, Library, MoreHorizontal, Pencil, Share, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useConversationStore, useCurrentConversation } from '../store';
import { useTypewriter } from '../hooks/useTypewriter';
import { RenameDialog } from './RenameDialog';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { ShareDialog } from './ShareDialog';
import { WorkspaceManagerSheet } from './WorkspaceManagerSheet';
import { CreateGroupConversationDialog } from './CreateGroupConversationDialog';
import { useModuleTranslation } from '@/modules/localization';

export function ConversationHeader() {
  const navigate = useNavigate();
  const conversation = useCurrentConversation();
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const typewriterConversationId = useConversationStore((s) => s.typewriterConversationId);
  const typewriterName = useConversationStore((s) => s.typewriterName);
  const clearTypewriter = useConversationStore((s) => s.clearTypewriter);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const { t } = useModuleTranslation('conversation');

  // Typewriter effect for newly generated names
  const isTypewriting = typewriterConversationId === conversation?.id;
  const typewriterText = useTypewriter(isTypewriting ? typewriterName : null, 30, clearTypewriter);

  if (!conversation) return null;

  const displayTitle = isTypewriting && typewriterText ? typewriterText : conversation.title;
  const isGoverned = conversation.runtimeMode === 'governed';

  const handleShare = () => {
    setShareOpen(true);
  };

  const handleRename = async (newTitle: string) => {
    await updateConversation(conversation.id, { title: newTitle });
  };

  const handleDelete = async () => {
    await deleteConversation(conversation.id);
    navigate('/');
  };

  return (
    <>
      <div className='sticky top-0 z-10 flex items-center gap-3 p-4 border-b border-border/50 bg-background/80 backdrop-blur-sm'>
        <Button variant='ghost' size='icon' onClick={() => navigate('/')} className='shrink-0'>
          <ArrowLeft className='h-4 w-4' />
        </Button>
        <h1 className='flex flex-1 items-center gap-2 font-medium text-lg truncate'>{isGoverned && <ShieldCheck className='size-4 shrink-0 text-primary' aria-label={t('governedConversation.title')} />}{displayTitle}</h1>

        <div className='flex items-center gap-1'>
          {conversation.groupMeta?.isGroup && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant='ghost' size='icon' onClick={() => setGroupDialogOpen(true)} className='shrink-0 text-primary'>
                    <Users className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('newConversation.groupDialog.manageTitle')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!isGoverned && <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={() => setWorkspaceSheetOpen(true)} className='shrink-0'>
                  <Library className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('header.tooltips.workspaces')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>}
          {!isGoverned && <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={handleShare} className='shrink-0'>
                  <Share className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('header.tooltips.share')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' className='shrink-0'>
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => setRenameOpen(true)} className='cursor-pointer'>
                <Pencil className='mr-2 h-4 w-4' />
                {t('header.actions.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteOpen(true)} className='cursor-pointer text-destructive focus:text-destructive'>
                <Trash2 className='mr-2 h-4 w-4' />
                {t('header.actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} currentTitle={conversation.title} onRename={handleRename} />

      <DeleteConversationDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleDelete} title={conversation.title} />

      {!isGoverned && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} conversationId={conversation.id} conversationTitle={conversation.title} />}

      {!isGoverned && <WorkspaceManagerSheet open={workspaceSheetOpen} onOpenChange={setWorkspaceSheetOpen} conversationId={conversation.id} workspaceIds={conversation.workspaces || []} />}

      <CreateGroupConversationDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} mode='manage' />
    </>
  );
}
