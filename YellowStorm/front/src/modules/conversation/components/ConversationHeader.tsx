import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowLeft, Library, Pencil, Share, ShieldCheck, Trash2, Users } from 'lucide-react';
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
      <div className='sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-background/85 px-3 py-3 backdrop-blur-sm md:px-4'>
        <Button variant='ghost' size='icon' onClick={() => navigate('/')} className='size-11 shrink-0 md:size-9' aria-label={t('header.actions.back')}>
          <ArrowLeft className='h-4 w-4' />
        </Button>
        <div className='flex min-w-0 flex-1 items-center gap-1'>
          <h1 className='flex min-w-0 items-center gap-2 font-medium text-lg'>
            {isGoverned && <ShieldCheck className='size-4 shrink-0 text-primary' aria-label={t('governedConversation.title')} />}
            <span className='truncate'>{displayTitle}</span>
          </h1>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={() => setRenameOpen(true)} className='size-11 shrink-0 text-muted-foreground hover:text-foreground md:size-8' aria-label={t('header.actions.rename')}>
                  <Pencil className='size-3.5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('header.actions.rename')}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className='flex items-center gap-1'>
          {conversation.groupMeta?.isGroup && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant='ghost' size='icon' onClick={() => setGroupDialogOpen(true)} className='size-11 shrink-0 text-primary md:size-9' aria-label={t('newConversation.groupDialog.manageTitle')}>
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
                <Button variant='ghost' size='icon' onClick={() => setWorkspaceSheetOpen(true)} className='size-11 shrink-0 md:size-9' aria-label={t('header.tooltips.workspaces')}>
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
                <Button variant='ghost' size='icon' onClick={handleShare} className='size-11 shrink-0 md:size-9' aria-label={t('header.tooltips.share')}>
                  <Share className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('header.tooltips.share')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={() => setDeleteOpen(true)} className='size-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:size-9' aria-label={t('header.actions.delete')}>
                  <Trash2 className='size-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('header.actions.delete')}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
